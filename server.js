import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

/**
 * Endpoint POST /quest/scenario
 * Génère l'introduction et initialise le contexte caché de la quête
 */
app.post("/quest/scenario", async (req, res) => {
  const { player, quest, mode } = req.body;

  if (!player || !quest) {
    return res.status(400).json({ error: "Données manquantes." });
  }

  // Correction des clés pour correspondre au frontend (races, characterClass)
  const playerRace = player.races || "Humain";
  const playerClass = player.characterClass || "Aventurier";
  const playerStats = JSON.stringify(player.stats || {});

  const systemPrompt = `
    Tu es l'Oracle Céleste, un MJ de RPG sombre et épique.
    Ton rôle est de créer l'introduction d'une quête interactive.
    IMPORTANT : Tu dois définir secrètement un "scénario caché" (ce que le joueur ne sait pas encore).
    Réponds UNIQUEMENT par un objet JSON.
  `;

  const userPrompt = `
    ZONE : ${quest.zoneName}
    RANG : ${quest.rank}
    MISSION : ${quest.task || quest.title}
    JOUEUR : ${player.name} (Race: ${playerRace}, Classe: ${playerClass})
    STATS : ${playerStats}
    MODE : ${mode}

    Génère un titre, une intro narrative, et définit les éléments cachés du scénario.
    Structure JSON attendue :
    {
      "title": "Titre de la quête",
      "intro": "L'amorce de l'histoire racontée au joueur",
      "hidden_plot": "Ce qui se passe réellement en coulisse",
      "hazard": "Le danger immédiat",
      "companion": ${mode === 'team' ? '{"name": "Nom", "role": "Classe"}' : 'null'},
      "reward_gold": ${quest.reward_gold || (quest.rewards ? quest.rewards.manacoins : 0)}
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
        model: "gpt-4o-mini", // Utilisation de gpt-4o-mini comme dans ton original
        temperature: 0.8,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" }
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    
    res.json(JSON.parse(data.choices[0].message.content));
  } catch (error) {
    console.error("Erreur Scenario:", error);
    res.status(500).json({ error: "Erreur Oracle Scenario" });
  }
});

/**
 * Endpoint POST /quest/progress
 * L'IA réagit à l'action du joueur
 */
app.post("/quest/progress", async (req, res) => {
  const { player, quest, action } = req.body;

  const systemPrompt = `
    Tu es l'Oracle Céleste (MJ). Le joueur vient d'effectuer une action. 
    Tu dois décrire les conséquences, faire avancer l'intrigue et jouer les ennemis.
  `;

  const userPrompt = `
    CONTEXTE : ${quest.intro}
    COMPLOT : ${quest.hidden_plot}
    DANGER : ${quest.hazard}
    HISTORIQUE : ${JSON.stringify(quest.journal || [])}
    ACTION DU JOUEUR : "${action}"
    STATS DU JOUEUR : ${JSON.stringify(player.stats)}

    Réponds par un texte narratif court (3-5 phrases).
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
        ]
      })
    });

    const data = await response.json();
    res.json({ aiResponse: data.choices[0].message.content });
  } catch (error) {
    res.status(500).json({ aiResponse: "L'Oracle reste muet..." });
  }
});

/**
 * Endpoint POST /quest/resolve
 */
app.post("/quest/resolve", async (req, res) => {
  const { player, quest } = req.body;

  const systemPrompt = `Tu es l'Oracle Céleste. Juge final. Réponds UNIQUEMENT en JSON.`;

  const userPrompt = `
    OBJECTIF : ${quest.title}
    HISTORIQUE : ${JSON.stringify(quest.journal)}
    STRUCTURE JSON :
    {
      "success": boolean,
      "reason": "Résumé de la fin",
      "rewards": { "gold": ${quest.reward_gold || 0}, "exp": 25 }
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
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" }
      })
    });

    const data = await response.json();
    res.json(JSON.parse(data.choices[0].message.content));
  } catch (error) {
    res.status(500).json({ success: false, reason: "Destin incertain.", rewards: { gold: 0, exp: 5 } });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`L'Oracle est éveillé sur le port ${PORT}`);
});