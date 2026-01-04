import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

// Configuration du modèle et limites
const API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent";
const apiKey = ""; // La clé est injectée par l'environnement

/**
 * Système de Retry avec Exponential Backoff
 */
async function fetchWithRetry(url, options, retries = 5, backoff = 1000) {
    try {
        const res = await fetch(url, options);
        if (!res.ok && retries > 0) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (err) {
        if (retries <= 0) throw err;
        await new Promise(r => setTimeout(r, backoff));
        return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
}

/**
 * Analyse les statistiques pour le MJ
 */
const getStatsContext = (player) => {
    const s = player.stats || {};
    return `
    RESTATS VITALES (Modifiables) : PV: ${s.PV}, PM: ${s.PM}, Endurance: ${s.Endurance}
    STAT FIXE : Chance: ${s.Chance} (Efficacité liée aux PV restants)
    STATS DÉPENDANTES : PA: ${s.PA}, PF: ${s.PF}, Maîtrise: ${s.Maîtrise}, Concentration: ${s.Concentration}, Volonté: ${s.Volonté}, Précision: ${s.Précision}, Vitesse: ${s.Vitesse}
    PROFIL : Race ${player.race}, Classe ${player.class}, Rang ${player.rank}
    COMPÉTENCES : ${JSON.stringify(player.skills || [])}
    ATTRIBUTS : ${JSON.stringify(player.attributes || [])}
    `;
};

app.post("/quest/scenario", async (req, res) => {
    const { player, quest, mode } = req.body;

    const systemPrompt = `Tu es l'Oracle Céleste. 
    Crée une introduction de quête. 
    Si le mode est 'team', ajoute un PNJ Compagnon qui accompagne le joueur.
    Prends en compte la race (${player.race}) et la classe (${player.class}) pour adapter l'ambiance.
    Réponds UNIQUEMENT en JSON.`;

    const userPrompt = `
    QUÊTE: ${quest.title} en zone ${quest.zoneName} (Rang ${quest.rank}).
    JOUEUR: ${player.name}, ${player.race} ${player.class}.
    CONTEXTE STATS: ${getStatsContext(player)}
    
    Structure JSON attendue:
    {
        "title": "Titre épique",
        "intro": "Texte d'intro",
        "hidden_plot": "Secret de la quête",
        "companion": {"name": "Nom", "role": "Classe", "personality": "Description"},
        "hazard": "Menace principale",
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
        res.json(JSON.parse(data.candidates[0].content.parts[0].text));
    } catch (error) {
        res.status(500).json({ error: "Erreur Oracle" });
    }
});

app.post("/quest/progress", async (req, res) => {
    const { player, quest, action } = req.body;

    const systemPrompt = `Tu es le MJ de l'Oracle Céleste. 
    Tu dois arbitrer l'action du joueur en respectant ces règles :
    1. RÉALISME DE CLASSE : Un mage ne peut pas faire d'attaques physiques lourdes. Un guerrier ne peut pas lancer de sorts.
    2. COOLDOWN : Les Compétences Uniques (rang F) ont 3h de cooldown. Si le joueur en utilise une, vérifie si c'est cohérent.
    3. CONSOMMATION : Réduis les PV/PM/Endurance selon la difficulté.
    4. INTERVENTION PNJ : Fais parler ou agir le compagnon (${quest.companion?.name}) si présent.
    5. ÉLÉMENTS : Respecte les forces/faiblesses élémentaires selon les attributs du joueur.`;

    const userPrompt = `
    ACTION DU JOUEUR: "${action}"
    INFOS JOUEUR: ${getStatsContext(player)}
    HISTORIQUE: ${JSON.stringify(quest.journal.slice(-3))}
    COMPLOT CACHÉ: ${quest.hidden_plot}
    
    Décris les conséquences narratives, les dégâts subis/infligés et l'évolution de la scène.`;

    try {
        const data = await fetchWithRetry(`${API_URL}?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: userPrompt }] }],
                systemInstruction: { parts: [{ text: systemPrompt }] }
            })
        });
        res.json({ aiResponse: data.candidates[0].content.parts[0].text });
    } catch (error) {
        res.status(500).json({ aiResponse: "L'Oracle est troublé par cette action." });
    }
});

app.post("/quest/resolve", async (req, res) => {
    const { player, quest } = req.body;

    const systemPrompt = `Juge final de l'Oracle. Détermine le succès.
    Si le journal est trop court ou les actions incohérentes avec la classe/race : ÉCHEC.`;

    const userPrompt = `
    Stats finales: ${getStatsContext(player)}
    Journal: ${JSON.stringify(quest.journal)}
    
    JSON attendu:
    {
        "success": boolean,
        "reason": "Explication narrative",
        "rewards": {"gold": ${quest.reward_gold}, "exp": 25}
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
        res.json(JSON.parse(data.candidates[0].content.parts[0].text));
    } catch (error) {
        res.status(500).json({ success: false, reason: "Destin brisé.", rewards: {gold: 0, exp: 5} });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Oracle V2 sur port ${PORT}`));