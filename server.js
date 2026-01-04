import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

// L'URL du modèle Gemini 2.5 Flash
const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent";
const apiKey = ""; // La clé est injectée par l'environnement

/**
 * Système de Retry avec Exponential Backoff pour la stabilité des appels API
 */
async function fetchWithRetry(url, options, retries = 5, backoff = 1000) {
    try {
        const res = await fetch(url, options);
        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(`HTTP ${res.status}: ${JSON.stringify(errorData)}`);
        }
        return await res.json();
    } catch (err) {
        if (retries <= 0) throw err;
        await new Promise(r => setTimeout(r, backoff));
        return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
}

/**
 * Formate le contexte du joueur pour le LLM (Maître du Jeu)
 */
const getStatsContext = (player) => {
    const s = player.stats || {};
    // On utilise les noms de propriétés exacts de votre objet 'player'
    return `
    UNITÉ : ${player.name || 'Inconnu'}
    RACE : ${player.races || 'Humain'}
    CLASSE : ${player.characterClass || 'Aventurier'}
    RANG : ${player.rank || 'F'}
    
    ÉCHELLE VITALE : 
    - PV (Points de Vie): ${s.PV || 100}
    - PM (Points de Mana): ${s.PM || 50}
    - Endurance: ${s.Endurance || 100}
    
    ATTRIBUTS DE COMBAT :
    - Force (PF): ${s.PF || 10}, Agilité (PA): ${s.PA || 10}
    - Maîtrise: ${s.Maîtrise || 5}, Vitesse: ${s.Vitesse || 5}
    - Chance: ${s.Chance || 0}, Précision: ${s.Précision || 10}
    
    CAPACITÉS : ${JSON.stringify(player.skills || [])}
    `;
};

/**
 * ROUTE 1 : Génération du Scénario initial
 */
app.post("/quest/scenario", async (req, res) => {
    const { player, quest, mode } = req.body;

    const systemPrompt = `Tu es l'Oracle Céleste, un narrateur mystique et impartial. 
    Ta mission est de créer une introduction immersive pour une quête. 
    Règles :
    1. Si mode == 'team', inclus obligatoirement un PNJ compagnon utile.
    2. Adapte le ton à la race (${player.races}) et la classe (${player.characterClass}).
    3. Le danger doit être proportionnel au Rang ${quest.rank}.
    4. Réponds EXCLUSIVEMENT en JSON pur.`;

    const userPrompt = `
    DÉTAILS DE LA MISSION :
    - Titre : ${quest.title}
    - Zone : ${quest.zoneName}
    - Rang de Menace : ${quest.rank}
    - Mode : ${mode}
    
    PROFIL DU JOUEUR :
    ${getStatsContext(player)}
    
    Génère ce JSON :
    {
        "title": "Titre stylisé",
        "intro": "Une narration immersive (2-3 phrases) à la deuxième personne du singulier.",
        "hidden_plot": "Un secret ou un rebondissement que le joueur ignore encore.",
        "companion": {"name": "Nom", "role": "Sa fonction", "personality": "Bref trait"},
        "hazard": "La menace principale (monstre, piège, énigme)",
        "reward_gold": ${quest.rewards?.manacoins || 0}
    }
    `;

    try {
        const data = await fetchWithRetry(`${API_URL}?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: userPrompt }] }],
                systemInstruction: { parts: [{ text: systemPrompt }] },
                generationConfig: { responseMimeType: "application/json" }
            })
        });
        const resultText = data.candidates[0].content.parts[0].text;
        res.json(JSON.parse(resultText));
    } catch (error) {
        console.error("Erreur Scenario:", error);
        res.status(500).json({ error: "L'Oracle est aveuglé." });
    }
});

/**
 * ROUTE 2 : Progression narrative (Actions du joueur)
 */
app.post("/quest/progress", async (req, res) => {
    const { player, quest, action } = req.body;

    const systemPrompt = `Tu es le Maître du Jeu (MJ). Tu arbitres l'action du joueur.
    Règles d'arbitrage :
    - Cohérence : Un ${player.characterClass} doit agir selon ses capacités.
    - Conséquences : Si l'action est risquée, décris les dégâts ou la fatigue.
    - Compagnon : Fais intervenir ${quest.companion?.name || 'le destin'} dans la réponse.
    - Style : Narratif, sombre et épique. Pas de chiffres bruts dans le texte, sauf si nécessaire.`;

    const userPrompt = `
    ACTION DU JOUEUR : "${action}"
    
    CONTEXTE :
    - Quête : ${quest.title}
    - Complot caché : ${quest.hidden_plot}
    - Historique récent : ${JSON.stringify(quest.journal ? quest.journal.slice(-2) : [])}
    
    PROFIL :
    ${getStatsContext(player)}
    
    Décris ce qui arrive ensuite de manière concise (max 4 phrases).`;

    try {
        const data = await fetchWithRetry(`${API_URL}?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: userPrompt }] }],
                systemInstruction: { parts: [{ text: systemPrompt }] }
            })
        });
        const responseText = data.candidates[0].content.parts[0].text;
        res.json({ aiResponse: responseText });
    } catch (error) {
        console.error("Erreur Progress:", error);
        res.status(500).json({ aiResponse: "L'Oracle ne parvient pas à lire ce futur." });
    }
});

/**
 * ROUTE 3 : Résolution de la quête (Calcul du succès)
 */
app.post("/quest/resolve", async (req, res) => {
    const { player, quest } = req.body;

    const systemPrompt = `Tu es le Juge du Destin. Analyse le journal de quête pour décider du succès final.
    Critères d'échec :
    1. Si le joueur a tenté des actions impossibles pour sa classe.
    2. Si le journal est trop pauvre (manque d'effort).
    3. Si les blessures accumulées auraient dû être fatales.`;

    const userPrompt = `
    JOURNAL DE L'INCURSION :
    ${JSON.stringify(quest.journal)}
    
    PROFIL JOUEUR :
    ${getStatsContext(player)}
    
    Génère ce JSON :
    {
        "success": true/false,
        "reason": "Résumé de la fin de l'aventure et pourquoi c'est un succès/échec.",
        "rewards": {"gold": ${quest.reward_gold || 0}, "exp": 25}
    }
    `;

    try {
        const data = await fetchWithRetry(`${API_URL}?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: userPrompt }] }],
                systemInstruction: { parts: [{ text: systemPrompt }] },
                generationConfig: { responseMimeType: "application/json" }
            })
        });
        const resultText = data.candidates[0].content.parts[0].text;
        res.json(JSON.parse(resultText));
    } catch (error) {
        console.error("Erreur Resolve:", error);
        res.status(500).json({ 
            success: false, 
            reason: "Le fil du destin a cassé prématurément.", 
            rewards: { gold: 0, exp: 5 } 
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[Oracle V2] Serveur actif sur le port ${PORT}`);
});