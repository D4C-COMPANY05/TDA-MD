import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

/**
 * Génère un ID unique
 */
function generateId() {
  return crypto.randomUUID();
}

/**
 * Endpoint POST /quest/scenario
 * Génère l'introduction et le danger de la quête
 */
app.post("/quest/scenario", async (req, res) => {
  const { player, quest, mode } = req.body;

  if (!player || !quest) {
    return res.status(400).json({ error: "Données manquantes." });
  }

  const systemPrompt = `
    Tu es l'Oracle Céleste, un MJ de RPG sombre et épique.
    Ton rôle est de créer l'introduction d'une quête.
    Répond UNIQUEMENT par un objet JSON.
  `;

  const userPrompt = `
    ZONE : ${quest.zoneName}
    RANG : ${quest.rank}
    MISSION : ${quest.task}
    JOUEUR : ${player.name} (${player.race}), Stats: ${JSON.stringify(player.stats)}
    MODE : ${mode}

    Génère un titre, une intro et un "hazard" (danger spécifique).
    Structure JSON :
    {
      "title": "string",
      "intro": "string",
      "hazard": "string",
      "duration": 180,
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
        temperature: 0.7,
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
 * Endpoint POST /quest/resolve
 * Analyse les actions du joueur et décide du succès ou de l'échec
 */
app.post("/quest/resolve", async (req, res) => {
  const { player, quest } = req.body;

  if (!player || !quest || !quest.journal) {
    return res.status(400).json({ error: "Données de résolution manquantes." });
  }

  const systemPrompt = `
    Tu es l'Oracle Céleste. Tu dois juger si un joueur a réussi sa quête.
    Analyse le journal d'actions par rapport au danger (hazard) et aux statistiques du joueur.
    
    CRITÈRES DE JUGEMENT :
    1. COHÉRENCE : Les actions sont-elles logiques face au danger ?
    2. RÉALISME : Un joueur de rang ${player.rank} avec ces stats peut-il réussir ce qu'il a décrit ?
    3. EFFORT : Si le journal est trop court ou vide, c'est un ÉCHEC.
    4. RÉCOMPENSE : Si succès, attribue l'or prévu (${quest.reward_gold}).

    Répond UNIQUEMENT en JSON.
  `;

  const userPrompt = `
    DANGER À AFFRONTER : ${quest.hazard}
    OBJECTIF : ${quest.title}
    
    STATS DU JOUEUR : ${JSON.stringify(player.stats)}
    RANG DU JOUEUR : ${player.rank}

    JOURNAL DES ACTIONS DU JOUEUR :
    ${quest.journal.map((a, i) => `Action ${i+1}: ${a}`).join("\n")}

    STRUCTURE JSON ATTENDUE :
    {
      "success": boolean,
      "reason": "Une explication narrative de 2-3 phrases sur pourquoi c'est un succès ou un échec.",
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
        temperature: 0.5, // Plus bas pour plus de cohérence
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) throw new Error("Erreur API OpenAI");

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);

    // Ajustement des récompenses si échec
    if (!result.success) {
      result.rewards = { gold: 0, exp: 5 };
    } else {
      result.rewards = { gold: quest.reward_gold || 0, exp: 25 };
    }

    res.json(result);

  } catch (error) {
    console.error("Erreur Résolution :", error);
    res.status(500).json({ 
      success: false, 
      reason: "L'Oracle a été interrompu dans sa vision. Par défaut, vous avez survécu de justesse.",
      rewards: { gold: 0, exp: 5 }
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`L'Oracle écoute sur le port ${PORT}`);
});