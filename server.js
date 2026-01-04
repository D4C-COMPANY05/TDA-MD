import express from "express";
import OpenAI from "openai";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

// Initialisation OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY, 
});

/**
 * Nettoyage des données du joueur pour le Prompt
 */
const getStatsContext = (player) => {
    const s = player.stats || {};
    return `
    IDENTITÉ : ${player.name || 'Inconnu'}
    PROFIL : ${player.races || 'Humain'} ${player.characterClass || 'Aventurier'} (Rang ${player.rank || 'F'})
    ÉCHELLE : PV:${s.PV || 100}, PM:${s.PM || 50}, End:${s.Endurance || 100}
    ATTRIBUTS : Force:${s.PF || 10}, Agi:${s.PA || 10}, Maîtrise:${s.Maîtrise || 5}, Chance:${s.Chance || 0}
    COMPÉTENCES : ${JSON.stringify(player.skills || [])}
    `;
};

// --- ROUTE 1 : SCÉNARIO (L'étape qui posait problème) ---
app.post("/quest/scenario", async (req, res) => {
    const { player, quest, mode } = req.body;

    // Log pour debug dans Render
    console.log(`Génération scénario pour ${player.name} - Quête: ${quest.title}`);

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o", 
            messages: [
                { 
                    role: "system", 
                    content: "Tu es l'Oracle. Tu génères du JSON pur. Ne parle pas, ne commente pas, renvoie juste l'objet." 
                },
                { 
                    role: "user", 
                    content: `Génère l'intro de quête.
                    QUÊTE: ${quest.title} (${quest.zoneName})
                    JOUEUR: ${getStatsContext(player)}
                    MODE: ${mode}

                    FORMAT JSON STRICT :
                    {
                        "title": "Titre épique",
                        "intro": "Texte narratif (2-3 phrases)",
                        "hidden_plot": "Secret de quête",
                        "companion": ${mode === 'team' ? '{"name": "Nom", "role": "Classe"}' : 'null'},
                        "hazard": "Menace principale",
                        "reward_gold": ${quest.rewards?.manacoins || 0}
                    }`
                }
            ],
            response_format: { type: "json_object" },
            temperature: 0.7
        });

        const content = completion.choices[0].message.content;
        console.log("Réponse OpenAI reçue.");
        res.json(JSON.parse(content));

    } catch (error) {
        console.error("ERREUR SCENARIO:", error.message);
        res.status(500).json({ error: "Erreur Oracle", details: error.message });
    }
});

// --- ROUTE 2 : PROGRESSION ---
app.post("/quest/progress", async (req, res) => {
    const { player, quest, action } = req.body;

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: "Tu es le MJ. Décris les conséquences de l'action de façon immersive et courte." },
                { role: "user", content: `CONTEXTE: ${quest.title}. JOUEUR: ${getStatsContext(player)}. ACTION: ${action}.` }
            ],
            max_tokens: 150
        });

        res.json({ aiResponse: completion.choices[0].message.content });
    } catch (error) {
        console.error("ERREUR PROGRESS:", error);
        res.status(500).json({ aiResponse: "L'Oracle est troublé." });
    }
});

// --- ROUTE 3 : RESOLUTION ---
app.post("/quest/resolve", async (req, res) => {
    const { player, quest } = req.body;

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: "Juge final. Réponds en JSON." },
                { role: "user", content: `Analyse le succès. Journal: ${JSON.stringify(quest.journal)}. Stats: ${getStatsContext(player)}.
                JSON: {"success": boolean, "reason": "Texte", "rewards": {"gold": ${quest.reward_gold}, "exp": 25}}` }
            ],
            response_format: { type: "json_object" }
        });

        res.json(JSON.parse(completion.choices[0].message.content));
    } catch (error) {
        res.status(500).json({ success: false, reason: "Destin brisé." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Oracle OpenAI Ready sur port ${PORT}`));