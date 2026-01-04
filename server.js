import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors()); // Autorise les requêtes depuis votre interface front-end

/**
 * Génère un ID unique pour le scénario
 */
function generateId() {
  return crypto.randomUUID();
}

/**
 * Endpoint POST /quest/scenario
 * Reçoit { player, quest, mode }
 */
app.post("/quest/scenario", async (req, res) => {
  const { player, quest, mode } = req.body;

  // Validation des entrées
  if (!player || !quest) {
    return res.status(400).json({ error: "Données du joueur ou de la quête manquantes." });
  }

  const systemPrompt = `
    Tu es l'Oracle Céleste, un Maître du Jeu (MJ) RPG expert en narration immersive et sombre.
    Ton rôle est de transformer une fiche technique de quête en une expérience narrative.

    RÈGLES CRITIQUES :
    1. Respect STRICT de l'objectif de la quête : ${quest.task}.
    2. Adaption selon le MODE : ${mode === 'team' ? 'Le joueur est avec une équipe de mercenaires.' : 'Le joueur est absolument seul.'}.
    3. Ton : Épique, mystique, parfois cruel.
    4. Répond UNIQUEMENT par un objet JSON valide.
  `;

  const userPrompt = `
    DONNÉES DU MONDE :
    - Zone : ${quest.zoneName || 'Inconnue'}
    - Rang de Danger : ${quest.rank}
    - Titre du Contrat : ${quest.title}

    PROFIL DU JOUEUR :
    - Nom : ${player.name}
    - Race : ${player.race}
    - Stats : ${JSON.stringify(player.stats)}

    MISSION :
    Génère un scénario incluant une introduction narrative, un danger spécifique lié au rang, et l'impact physique attendu.

    STRUCTURE JSON ATTENDUE :
    {
      "title": "Titre narratif retravaillé",
      "intro": "Texte d'ambiance de 2-3 phrases",
      "hazard": "Description du péril spécifique rencontré",
      "duration": 180, 
      "impact": {
        "pv": 15,
        "pm": 10,
        "endurance": 20
      },
      "reward_gold": ${quest.rewards?.manacoins || 0},
      "reward_item": "${quest.rewards?.item || ''}"
    }
  `;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`OpenAI API Error: ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    const scenarioRaw = data.choices[0].message.content;

    // Parsing du JSON généré par l'IA
    const scenario = JSON.parse(scenarioRaw);

    // Ajout de métadonnées serveur
    scenario.server_id = generateId();
    scenario.timestamp = Date.now();
    scenario.quest_origin_id = quest.id;

    res.json(scenario);

  } catch (error) {
    console.error("Erreur Oracle :", error);
    res.status(500).json({ 
      error: "L'Oracle est silencieux pour le moment.",
      message: error.message 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`L'Oracle écoute sur le port ${PORT}`);
});