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
MP: ${Math.ceil(s.mp_ps || s.mp)}/${s.mp_psMax || b.mp_psMax || b.mp_ps}
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
- CONSOMMATION OBLIGATOIRE : Déduis des hpLoss, mp_psLoss et endLoss. 
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
    "mp_psLoss": number,
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
    // Sécurité : Si l'IA a mal formé le JSON
if (!result.worldState) {
  result.worldState = { hpLoss: 0, mp_psLoss: 0, endLoss: 0, newHazard: quest.hazard || "RAS" };
}

    // Synchronisation avec les clés hp / MP_PS / ENDURANCE
    // Remplace ton bloc newStats par celui-ci :
const s = quest.stats || {};
const ws = result.worldState || {};

const newStats = {
  ...s,
  hp: clamp(Number(s.hp || 0) - Number(ws.hpLoss || 0), 0, Number(s.hpMax || 100)),
  mp_ps: clamp(Number(s.mp_ps || 0) - Number(ws.mp_psLoss || 0), 0, Number(s.mp_psMax || 100)),
  endurance: clamp(Number(s.endurance || 0) - Number(ws.endLoss || 0), 0, Number(s.endMax || 100))
};


    // Mise à jour de la chronique simplifiée pour la mémoire de l'IA
    const updatedChronicle = `${chronicle}\n- Action: ${action} | Résultat: ${result.worldState.newHazard || "Action effectuée"}`;


        const output = {
      narrative: result.narrative || "L'Oracle reste silencieux sur les détails...",
      newStats,
      progress: result.progress ?? quest.progress ?? 0,
      hazard: ws.newHazard || "Zone stable",
      secretFound: !!(ws.secretFound || quest.secretFound),
      isDead: !!ws.isDead,
      chronicle: updatedChronicle,
      flags: ws.flagsUpdated || flags
    };


    res.json(output);
  } catch (e) {
  console.error("ERREUR SERVEUR:", e.message); // Ceci apparaîtra dans tes logs Render/Terminal
  res.status(500).json({ 
    aiResponse: "Le destin vacille.", 
    debug: e.message 
  });
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