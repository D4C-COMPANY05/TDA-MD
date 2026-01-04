import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

// Helper pour formater le contexte (inclut désormais les stats actuelles de l'incursion)
const formatPlayerContext = (player, currentStats = null) => {
  const stats = currentStats || player.baseStats || {};
  const race = Array.isArray(player.races) ? player.races.join("/") : "Inconnu";
  const skills = Array.isArray(player.uniqueSkills) ? player.uniqueSkills.map(s => s.name).join(", ") : "Aucune";

  return `
    NOM: ${player.avatarName} | CLASSE: ${player.characterClass} | RANG: ${player.rank}
    STATS ACTUELLES: HP:${Math.ceil(stats.hp)}/${stats.hpMax || stats.hp}, MP:${Math.ceil(stats.mp)}/${stats.mpMax || stats.mp}, END:${Math.ceil(stats.end)}/${stats.endMax || stats.end}
    COMPÉTENCES: ${skills}
    ATTRIBUTS: ${player.attributes?.join(", ") || "Aucun"}
  `;
};

/**
 * Endpoint /quest/scenario
 * Initialise la quête et les stats de combat
 */
app.post("/quest/scenario", async (req, res) => {
  const { player, quest, mode } = req.body;

  const systemPrompt = `
    Tu es un Maître du Jeu (MJ) de Dark Fantasy. Ton ton est immersif, sombre mais DIRECT. 
    Évite les mots trop complexes ou pompeux ("mysticisme", "émanations", "indicible"). 
    Parle d'actions concrètes. Réponds UNIQUEMENT en JSON.
  `;

  const userPrompt = `
    CONTEXTE: ${formatPlayerContext(player)}
    ZONE: ${quest.zoneName}
    MISSION: ${quest.task || quest.title}
    MODE: ${mode}

    Génère l'ouverture de l'incursion.
    Structure JSON attendue :
    {
      "title": "Titre court et percutant",
      "intro": "2 phrases d'ambiance directes sur ce que le joueur voit en arrivant.",
      "hidden_plot": "Le secret du lieu (ex: un traître parmi les gardes, un rituel caché)",
      "hazard": "La menace immédiate (ex: une meute de loups, un piège à pression)",
      "companion": ${mode === 'team' ? '{"name": "Kael", "role": "Guerrier de fer"}' : 'null'}
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
    res.status(500).json({ error: "L'Oracle est silencieux." });
  }
});

/**
 * Endpoint /quest/progress
 * Gère les actions, les dégâts et la progression de la barre
 */
app.post("/quest/progress", async (req, res) => {
  const { player, quest, action } = req.body;

  const systemPrompt = `
    Tu es un MJ de JDR. Le joueur te donne une action. 
    Tu dois décrire le résultat de manière humaine, courte et brutale.
    IMPORTANT : Tu dois mettre à jour les statistiques (HP, MP, END) et la progression (0 à 100).
    - Si le joueur attaque physiquement, il perd de l'Endurance (END).
    - Si le joueur utilise la magie, il perd du Mana (MP).
    - Si le danger (hazard) frappe, il perd des PV (HP).
    - Chaque action réussie augmente "newProgress" de 10 à 25 points.
    Réponds UNIQUEMENT en JSON.
  `;

  const userPrompt = `
    ÉTAT ACTUEL: ${formatPlayerContext(player, quest.stats)}
    PROGRESSION ACTUELLE: ${quest.progress}%
    INTRIGUE: ${quest.hidden_plot}
    DANGER: ${quest.hazard}
    ACTION DU JOUEUR: "${action}"

    Structure JSON :
    {
      "aiResponse": "Description de l'action (3 phrases max). Sois direct.",
      "newStats": {
        "hp": nombre,
        "mp": nombre,
        "end": nombre,
        "hpMax": ${quest.stats.hpMax},
        "mpMax": ${quest.stats.mpMax},
        "endMax": ${quest.stats.endMax},
        "pa": ${quest.stats.pa},
        "mai": ${quest.stats.mai},
        "vit": ${quest.stats.vit}
      },
      "newProgress": nombre (0-100),
      "newHazard": "Quelle est la nouvelle menace après cette action ?"
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
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        response_format: { type: "json_object" }
      })
    });

    const data = await response.json();
    res.json(JSON.parse(data.choices[0].message.content));
  } catch (error) {
    res.status(500).json({ aiResponse: "L'Oracle ne voit rien.", newProgress: quest.progress });
  }
});

/**
 * Endpoint /quest/resolve
 * Conclusion basée sur les stats restantes et le succès des actions
 */
app.post("/quest/resolve", async (req, res) => {
  const { player, quest } = req.body;

  const userPrompt = `
    Évalue la fin de l'incursion "${quest.title}".
    Stats finales: HP:${quest.stats.hp}/${quest.stats.hpMax}
    Journal: ${JSON.stringify(quest.journal.slice(-3))}
    Progression: ${quest.progress}%

    Si HP <= 0, c'est un échec total (success: false).
    Si progression >= 80%, c'est un succès.
    
    Réponds en JSON:
    {
      "success": boolean,
      "reason": "Une conclusion épique et courte (2 phrases).",
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
        messages: [{ role: "system", content: "Tu es le Juge du Destin. Sois bref." }, { role: "user", content: userPrompt }],
        response_format: { type: "json_object" }
      })
    });

    const data = await response.json();
    res.json(JSON.parse(data.choices[0].message.content));
  } catch (error) {
    res.status(500).json({ success: false, reason: "Le fil se brise." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Oracle V2.5 actif sur port ${PORT}`));