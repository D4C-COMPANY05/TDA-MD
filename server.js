import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

// Prompt pour humaniser les textes et gérer les stats
const SYSTEM_INSTRUCTIONS = `
Tu es un Maître de Jeu (MJ) de Dark Fantasy. 
CONSIGNES DE STYLE :
- Pas de mots compliqués comme "obscurcir", "ineffable", "mystérieux" à outrance.
- Parle comme un humain : sois direct, viscéral, parfois brutal.
- Décris les bruits, l'odeur, la douleur physique.
- Ne fais pas de morale.
`;

app.post("/quest/scenario", async (req, res) => {
  const { player, quest, mode } = req.body;
  const stats = player.baseStats || {};
  const mods = player.modifiers || {};

  const userPrompt = `
    DÉTAILS JOUEUR: ${player.avatarName}, ${player.characterClass} de rang ${player.rank}.
    ZONE: ${quest.zoneName}. MISSION: ${quest.title}.
    
    Initialise l'aventure. 
    RETOURNE CE JSON UNIQUEMENT :
    {
      "title": "Nom de la quête",
      "intro": "Accroche directe et courte",
      "phases": 4,
      "currentPhase": 1,
      "currentStats": {
        "hp": ${(stats.hp || 100) + (mods.hp || 0)},
        "maxHp": ${(stats.hp || 100) + (mods.hp || 0)},
        "mp": ${(stats.mp_ps || 50) + (mods.mp_ps || 0)},
        "maxMp": ${(stats.mp_ps || 50) + (mods.mp_ps || 0)},
        "stamina": ${(stats.endurance || 100) + (mods.endurance || 0)},
        "maxStamina": ${(stats.endurance || 100) + (mods.endurance || 0)}
      },
      "hazard": "Menace immédiate",
      "companion": ${mode === 'team' ? '{"name": "Kael", "role": "Voleur de sang"}' : 'null'}
    }
  `;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: SYSTEM_INSTRUCTIONS }, { role: "user", content: userPrompt }],
        response_format: { type: "json_object" }
      })
    });
    const data = await response.json();
    res.json(JSON.parse(data.choices[0].message.content));
  } catch (e) { res.status(500).json({ error: "L'Oracle est HS." }); }
});

app.post("/quest/progress", async (req, res) => {
  const { player, quest, action } = req.body;
  
  const userPrompt = `
    QUÊTE : ${quest.title} (Phase ${quest.currentPhase}/${quest.phases})
    STATS ACTUELLES : HP:${quest.currentStats.hp}, MP:${quest.currentStats.mp}, END:${quest.currentStats.stamina}
    ACTION DU JOUEUR : "${action}"
    
    Analyse l'action. Si c'est risqué, baisse les HP. Si c'est magique, baisse les MP. Si c'est physique, baisse l'Endurance.
    Si l'action est bonne, fais progresser la phase (+1).
    
    RETOURNE CE JSON UNIQUEMENT :
    {
      "narration": "Texte court, simple et humain de ce qu'il se passe",
      "statsUpdate": { "hp": -10, "mp": 0, "stamina": -5 },
      "phaseChange": 1
    }
  `;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: SYSTEM_INSTRUCTIONS }, { role: "user", content: userPrompt }],
        response_format: { type: "json_object" }
      })
    });
    const data = await response.json();
    res.json(JSON.parse(data.choices[0].message.content));
  } catch (e) { res.status(500).json({ error: "Échec narration." }); }
});

app.post("/quest/resolve", async (req, res) => {
  const { player, quest } = req.body;
  const isDead = quest.currentStats.hp <= 0;

  const userPrompt = `
    Résultat final. HP: ${quest.currentStats.hp}.
    Si HP <= 0, c'est un échec cuisant (mort ou fuite).
    Sinon, c'est un succès.
    
    JSON : { "success": ${!isDead}, "reason": "Texte de fin direct", "rewards": { "gold": 50, "exp": 30 } }
  `;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: SYSTEM_INSTRUCTIONS }, { role: "user", content: userPrompt }],
        response_format: { type: "json_object" }
      })
    });
    const data = await response.json();
    res.json(JSON.parse(data.choices[0].message.content));
  } catch (e) { res.status(500).json({ success: false, reason: "Le destin a tranché." }); }
});

const PORT = 3000;
app.listen(PORT);