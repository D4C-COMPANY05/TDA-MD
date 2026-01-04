import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

// Helper pour formater les stats du joueur pour l'IA
const formatPlayerContext = (player) => {
  const stats = player.baseStats || {};
  const mods = player.modifiers || {};
  const race = Array.isArray(player.races) ? player.races.join("/") : "Inconnu";
  const attributes = Array.isArray(player.attributes) ? player.attributes.join(", ") : "Aucun";
  const skills = Array.isArray(player.uniqueSkills) ? player.uniqueSkills.map(s => s.name).join(", ") : "Aucune";

  return `
    NOM: ${player.avatarName}
    RACE: ${race}
    CLASSE: ${player.characterClass}
    RANG: ${player.rank} (Niveau ${player.level})
    ATTRIBUTS: ${attributes}
    COMPÉTENCES UNIQUES: ${skills}
    STATS (Base + Mod): HP:${stats.hp}, PA:${stats.pa}+${mods.pa}, Mastery:${stats.mastery}+${mods.mastery}, Speed:${stats.speed}
  `;
};

/**
 * Endpoint POST /quest/scenario
 * Initialisation avec contexte riche
 */
app.post("/quest/scenario", async (req, res) => {
  const { player, quest, mode } = req.body;

  const playerInfo = formatPlayerContext(player);
  
  const systemPrompt = `
    Tu es l'Oracle Céleste. Tu génères une quête de RPG sombre.
    Le joueur est un ${player.characterClass}. Utilise ses attributs et ses compétences pour colorer l'intrigue.
    Réponds UNIQUEMENT en JSON.
  `;

  const userPrompt = `
    DÉTAILS JOUEUR: ${playerInfo}
    ZONE: ${quest.zoneName}
    MISSION DE BASE: ${quest.task || quest.title}
    MODE: ${mode}

    Génère un scénario complexe.
    Structure JSON :
    {
      "title": "Titre épique",
      "intro": "Narration immersive (2-3 phrases)",
      "hidden_plot": "Le secret du lieu ou la trahison prévue",
      "hazard": "La menace spécifique (monstre, piège, énigme)",
      "companion": ${mode === 'team' ? '{"name": "Eldrin", "role": "Paladin déchu"}' : 'null'},
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
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        response_format: { type: "json_object" }
      })
    });

    const data = await response.json();
    res.json(JSON.parse(data.choices[0].message.content));
  } catch (error) {
    res.status(500).json({ error: "L'Oracle est perturbé." });
  }
});

/**
 * Endpoint POST /quest/progress
 * Réaction aux actions spécifiques (ex: utiliser ses fils de marionnettiste)
 */
app.post("/quest/progress", async (req, res) => {
  const { player, quest, action } = req.body;

  const playerInfo = formatPlayerContext(player);

  const systemPrompt = `
    Tu es l'Oracle. MJ de Dark Fantasy.
    Analyse l'action du joueur en fonction de sa classe (${player.characterClass}) et ses stats.
    Si l'action mentionne une compétence ou un attribut (${player.attributes?.join(', ')}), le succès est plus probable.
  `;

  const userPrompt = `
    PROFIL JOUEUR: ${playerInfo}
    INTRIGUE CACHÉE: ${quest.hidden_plot}
    DANGER ACTUEL: ${quest.hazard}
    ACTION DU JOUEUR: "${action}"

    Décris les conséquences immédiates (3-5 phrases). Reste mystérieux mais juste.
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
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }]
      })
    });

    const data = await response.json();
    res.json({ aiResponse: data.choices[0].message.content });
  } catch (error) {
    res.status(500).json({ aiResponse: "L'ombre s'épaissit, votre action se perd dans le néant." });
  }
});

/**
 * Endpoint POST /quest/resolve
 */
app.post("/quest/resolve", async (req, res) => {
  const { player, quest } = req.body;

  const userPrompt = `
    Évalue l'issue de cette quête : "${quest.title}".
    Historique : ${JSON.stringify(quest.journal)}
    Complot initial : ${quest.hidden_plot}
    
    Réponds en JSON:
    {
      "success": boolean,
      "reason": "Texte de conclusion",
      "rewards": { "gold": ${quest.reward_gold}, "exp": 25 }
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
        messages: [{ role: "system", content: "Tu es le Juge Céleste." }, { role: "user", content: userPrompt }],
        response_format: { type: "json_object" }
      })
    });

    const data = await response.json();
    res.json(JSON.parse(data.choices[0].message.content));
  } catch (error) {
    res.status(500).json({ success: false, reason: "Le fil du destin a rompu." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`L'Oracle V2 est actif sur le port ${PORT}`);
});

