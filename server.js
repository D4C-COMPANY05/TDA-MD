import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

const RANGS_ORDRE = ["F", "E", "D", "C", "B", "A", "S", "SS", "SSS", "Z", "XE"];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const formatFullPlayerContext = (player, currentStats = null) => {
  const b = player.baseStats || {};
  const m = player.modifiers || {};
  const s = currentStats || b;

  return `
--- PROFIL DU PERSONNAGE ---
NOM: ${player.avatarName} | CLASSE: ${player.characterClass} | RANG: ${player.rank} | LVL: ${player.level}
ATTRIBUTS: ${player.attributes?.join(", ")}

UNITÉS VITALES ACTUELLES:
HP: ${Math.ceil(s.hp || s.hp)}/${s.hpMax || b.hpMax || b.hp}
MP: ${Math.ceil(s.mp_ps || s.mp)}/${s.mpMax || b.mpMax || b.mp_ps}
ENDURANCE: ${Math.ceil(s.endurance || s.end)}/${s.endMax || b.endMax || b.endurance}

STATISTIQUES DE COMBAT:
PA: ${s.pa || (b.pa + (m.pa || 0))} | PF: ${s.pf || (b.pf + (m.pf || 0))} | MAÎTRISE: ${s.mastery}
VITESSE: ${s.speed} | PRÉCISION: ${s.precision} | VOLONTÉ: ${s.willpower}

COMPÉTENCES:
${player.uniqueSkills?.map(sk => `- ${sk.name}: ${sk.description}`).join("\n")}
`;
};

/* ===================== SCÉNARIO ===================== */
app.post("/quest/scenario", async (req, res) => {
  const { player, quest, mode } = req.body;
  const systemPrompt = `Tu es le Maître du Jeu. Joueur [${player.rank}] vs Quête [${quest.rank}]. Réponds uniquement en JSON.`;
  const userPrompt = `CONTEXTE: ${formatFullPlayerContext(player)} | ZONE: ${quest.zoneName} | OBJECTIF: ${quest.task || quest.title}
  JSON attendu: {"title": "...", "intro": "...", "hidden_plot": "...", "secret_objective": "...", "hazard": "État initial (Position/Ennemis)", "chronicle": "L'incursion commence."}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        response_format: { type: "json_object" }
      })
    });
    const data = await response.json();
    res.json(JSON.parse(data.choices[0].message.content));
  } catch {
    res.status(500).json({ error: "L'Oracle est sourd." });
  }
});

/* ===================== PROGRESSION ===================== */
app.post("/quest/progress", async (req, res) => {
  const { player, quest, action, debug = false } = req.body;

  const chronicle = quest.chronicle || "Début de la quête.";
  const flags = quest.flags || [];

  const systemPrompt = `
Tu es la MÉMOIRE CANONIQUE et la LOGIQUE DU MONDE.
- Basé UNIQUEMENT sur la chronique.
- Aucun ennemi déjà vaincu ne réapparaît.
- CONSOMMATION OBLIGATOIRE : Déduis des hpLoss, mpLoss et endLoss. 
  * Un sort de Rang S coûte entre 5 et 40 PM (mp_ps).
  * Un effort physique coûte entre 5 et 20 ENDURANCE.
- ÉTAT DU MONDE (newHazard) : Doit impérativement mettre à jour la POSITION et les ENNEMIS restants.
- Applique les flags: ${flags.join(", ")}.
`;

  const userPrompt = `
CHRONIQUE ACTUELLE: ${chronicle}
JOUEUR: ${formatFullPlayerContext(player, quest.stats)}
DANGER/ÉTAT PRÉCÉDENT: ${quest.hazard}
ACTION: "${action}"

Réponds STRICTEMENT en JSON:
{
  "narrative": "Description visible",
  "worldState": {
    "hpLoss": number,
    "mpLoss": number,
    "endLoss": number,
    "newHazard": "Position actuelle | Ennemis restants",
    "flagsUpdated": [],
    "secretFound": boolean,
    "isDead": boolean
  },
  "progress": number
}
`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        response_format: { type: "json_object" }
      })
    });

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);

    // Synchronisation avec les clés hp / MP_PS / ENDURANCE
    const s = quest.stats;
    const newStats = {
      ...s,
      hp: clamp((s.hp || s.hp) - (result.worldState.hpLoss || 0), 0, s.hpMax || s.hpMax),
      mp_ps: clamp((s.mp_ps || s.mp) - (result.worldState.mpLoss || 0), 0, s.mpMax || s.mp_psMax),
      endurance: clamp((s.endurance || s.end) - (result.worldState.endLoss || 0), 0, s.endMax)
    };

    // Mise à jour de la chronique simplifiée pour la mémoire de l'IA
    const updatedChronicle = `${chronicle}\n- Action: ${action} | Résultat: ${result.worldState.newHazard}`;

    const output = {
      narrative: result.narrative,
      newStats,
      progress: result.progress || quest.progress,
      hazard: result.worldState.newHazard,
      secretFound: result.worldState.secretFound || quest.secretFound,
      isDead: result.worldState.isDead,
      chronicle: updatedChronicle,
      flags: result.worldState.flagsUpdated || flags
    };

    res.json(output);
  } catch (e) {
    res.status(500).json({ aiResponse: "Le destin vacille." });
  }
});

/* ===================== RÉSOLUTION ===================== */
app.post("/quest/resolve", async (req, res) => {
  const { quest } = req.body;
  const userPrompt = `FIN DE QUÊTE: ${quest.title} | PROGRÈS: ${quest.progress}% | SECRET: ${quest.secretFound}. JSON: {"success":boolean, "reason":"...", "rewards":{"gold":0, "exp":0}}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: "Juge." }, { role: "user", content: userPrompt }],
        response_format: { type: "json_object" }
      })
    });
    const data = await response.json();
    res.json(JSON.parse(data.choices[0].message.content));
  } catch {
    res.status(500).json({ success: false, reason: "Erreur finale." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Oracle V4.3"));