import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
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

  const systemPrompt = `
    Tu es l'Oracle Céleste, un MJ de RPG sombre et épique.
    Ton rôle est de créer l'introduction d'une quête interactive.
    IMPORTANT : Tu dois définir secrètement un "scénario caché" (ce que le joueur ne sait pas encore).
    Réponds UNIQUEMENT par un objet JSON.
  `;

  const userPrompt = `
    ZONE : ${quest.zoneName}
    RANG : ${quest.rank}
    MISSION : ${quest.task}
    JOUEUR : ${player.name} (${player.race}), Stats: ${JSON.stringify(player.stats)}
    MODE : ${mode}

    Génère un titre, une intro narrative, et définit les éléments cachés du scénario.
    Structure JSON :
    {
      "title": "string",
      "intro": "L'amorce de l'histoire racontée au joueur",
      "hidden_plot": "Ce qui se passe réellement en coulisse (ex: une trahison, un monstre tapi dans l'ombre)",
      "hazard": "Le danger immédiat ou la menace principale",
      "reward_gold": ${quest.reward_gold || 0}
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
        temperature: 0.8,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" }
      })
    });

    const data = await response.json();
    res.json(JSON.parse(data.choices[0].message.content));
  } catch (error) {
    res.status(500).json({ error: "Erreur Oracle Scenario" });
  }
});

/**
 * Endpoint POST /quest/progress
 * L'IA réagit à l'action du joueur, joue les ennemis et fait avancer l'intrigue.
 */
app.post("/quest/progress", async (req, res) => {
  const { player, quest, action } = req.body;

  const systemPrompt = `
    Tu es l'Oracle Céleste (MJ). Le joueur vient d'effectuer une action. 
    Tu dois décrire les conséquences, faire avancer l'intrigue et jouer les ennemis/PNJ.
    
    RÈGLES STRICTES :
    1. LOGIQUE : Si l'action est risquée, utilise les stats du joueur pour décider du résultat.
    2. BROUILLARD DE GUERRE : Ne révèle jamais le "hidden_plot" directement. Donne des indices narratifs.
    3. ANTAGONISME : Si des ennemis sont présents, décris leurs attaques ou leurs mouvements de manière menaçante.
    4. SANS ABUS : Si le joueur fait une action logique et forte, laisse-le réussir, mais maintiens la tension.
    5. CHAMP DE VISION : Décris uniquement ce que le personnage peut voir/entendre.
  `;

  const userPrompt = `
    CONTEXTE INITIAL : ${quest.intro}
    COMPLOT CACHÉ : ${quest.hidden_plot}
    DANGER : ${quest.hazard}
    HISTORIQUE : ${JSON.stringify(quest.journal || [])}
    
    ACTION DU JOUEUR : "${action}"
    
    STATS DU JOUEUR : ${JSON.stringify(player.stats)}

    Réponds par un texte narratif court (3-5 phrases) qui décrit ce qui arrive ensuite.
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
    res.status(500).json({ aiResponse: "L'Oracle reste muet devant votre action..." });
  }
});

/**
 * Endpoint POST /quest/resolve
 * Analyse finale basée sur l'ensemble de l'échange narratif
 */
app.post("/quest/resolve", async (req, res) => {
  const { player, quest } = req.body;

  const systemPrompt = `
    Tu es l'Oracle Céleste. Juge final.
    Analyse si le joueur a triomphé ou péri en fonction de l'historique complet de la quête.
    Répond UNIQUEMENT en JSON.
  `;

  const userPrompt = `
    OBJECTIF : ${quest.title}
    COMPLOT CACHÉ ÉTAIT : ${quest.hidden_plot}
    
    HISTORIQUE DES ÉCHANGES :
    ${JSON.stringify(quest.journal)}

    STRUCTURE JSON :
    {
      "success": boolean,
      "reason": "Résumé narratif de la conclusion (victoire ou mort/fuite).",
      "rewards": { "gold": number, "exp": 25 }
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
        temperature: 0.5,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" }
      })
    });

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);
    
    result.rewards = result.success ? { gold: quest.reward_gold || 0, exp: 25 } : { gold: 0, exp: 5 };
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, reason: "Le destin est incertain.", rewards: { gold: 0, exp: 5 } });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`L'Oracle est éveillé sur le port ${PORT}`);
});