import express from "express";
import OpenAI from "openai";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

// Initialisation de l'API OpenAI
// Note : La clé API doit être définie dans les variables d'environnement de Render sous le nom OPENAI_API_KEY
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY, 
});

/**
 * Formate le contexte du joueur pour les prompts
 * Utilisation des clés exactes : races, characterClass, stats
 */
const getStatsContext = (player) => {
    const s = player.stats || {};
    return `
    NOM : ${player.name || 'Anonyme'}
    RACE : ${player.races || 'Humain'}
    CLASSE : ${player.characterClass || 'Aventurier'}
    RANG : ${player.rank || 'F'}
    
    STATISTIQUES ACTUELLES :
    PV: ${s.PV || 100}, PM: ${s.PM || 50}, Endurance: ${s.Endurance || 100}
    Force(PF): ${s.PF || 10}, Agilité(PA): ${s.PA || 10}, Maîtrise: ${s.Maîtrise || 5}
    Chance: ${s.Chance || 0}, Vitesse: ${s.Vitesse || 5}
    
    COMPÉTENCES : ${JSON.stringify(player.skills || [])}
    `;
};

// --- ROUTE 1 : GÉNÉRATION DU SCÉNARIO D'ENTRÉE ---
app.post("/quest/scenario", async (req, res) => {
    const { player, quest, mode } = req.body;

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o", 
            messages: [
                { 
                    role: "system", 
                    content: "Tu es l'Oracle Céleste. Tu crées des introductions de quêtes épiques et mystérieuses. Réponds exclusivement en JSON." 
                },
                { 
                    role: "user", 
                    content: `Génère un scénario pour : ${quest.title}. 
                    Lieu : ${quest.zoneName}. 
                    Mode : ${mode}. 
                    Joueur : ${getStatsContext(player)}.
                    
                    Format JSON requis :
                    {
                        "title": "Titre stylisé",
                        "intro": "Texte narratif immersif",
                        "hidden_plot": "Le secret de cette quête",
                        "companion": {"name": "Nom", "role": "Classe/Utilité"},
                        "hazard": "La menace principale",
                        "reward_gold": ${quest.rewards?.manacoins || 0}
                    }`
                }
            ],
            response_format: { type: "json_object" }
        });

        const scenarioData = JSON.parse(completion.choices[0].message.content);
        res.json(scenarioData);
    } catch (error) {
        console.error("Erreur Scenario OpenAI:", error);
        res.status(500).json({ error: "L'Oracle est incapable de lire le destin." });
    }
});

// --- ROUTE 2 : PROGRESSION DE L'ACTION ---
app.post("/quest/progress", async (req, res) => {
    const { player, quest, action } = req.body;

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { 
                    role: "system", 
                    content: "Tu es le MJ de l'Oracle Céleste. Décris les conséquences de l'action du joueur de manière narrative et concise." 
                },
                { 
                    role: "user", 
                    content: `ACTION : "${action}"
                    CONTEXTE JOUEUR : ${getStatsContext(player)}
                    QUÊTE : ${quest.title}
                    HISTORIQUE : ${JSON.stringify(quest.journal ? quest.journal.slice(-2) : [])}`
                }
            ]
        });

        res.json({ aiResponse: completion.choices[0].message.content });
    } catch (error) {
        console.error("Erreur Progress OpenAI:", error);
        res.status(500).json({ aiResponse: "Le flux temporel est perturbé." });
    }
});

// --- ROUTE 3 : RÉSOLUTION FINALE ---
app.post("/quest/resolve", async (req, res) => {
    const { player, quest } = req.body;

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { 
                    role: "system", 
                    content: "Tu es le Juge de l'Oracle. Évalue si la quête est un succès ou un échec. Réponds en JSON." 
                },
                { 
                    role: "user", 
                    content: `JOURNAL : ${JSON.stringify(quest.journal)}
                    JOUEUR : ${getStatsContext(player)}
                    
                    Format JSON requis :
                    {
                        "success": true/false,
                        "reason": "Résumé narratif du dénouement",
                        "rewards": {"gold": ${quest.reward_gold || 0}, "exp": 25}
                    }`
                }
            ],
            response_format: { type: "json_object" }
        });

        const resultData = JSON.parse(completion.choices[0].message.content);
        res.json(resultData);
    } catch (error) {
        console.error("Erreur Resolve OpenAI:", error);
        res.status(500).json({ success: false, reason: "Destin brisé.", rewards: { gold: 0, exp: 5 } });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveur Oracle OpenAI en ligne sur le port ${PORT}`);
});