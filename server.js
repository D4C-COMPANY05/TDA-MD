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
HP: ${Math.ceil(s.hp ?? (b.hp + (m.hp || 0)))}/${s.hpMax || (b.hp + (m.hp || 0))}
MP: ${Math.ceil(s.mp_ps ?? (b.mp_ps + (m.mp_ps || 0)))}/${s.mp_psMax || (b.mp_ps + (m.mp_ps || 0))}
ENDURANCE: ${Math.ceil(s.endurance ?? (b.endurance + (m.endurance || 0)))}/${s.endMax || (b.endurance + (m.endurance || 0))}

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
  const userPrompt = `
CONTEXTE: ${formatFullPlayerContext(player)}
ZONE: ${quest.zoneName}
OBJECTIF: ${quest.task || quest.title}

⚠️ OBLIGATION ABSOLUE :
- "title" doit être un titre narratif court
- "intro" doit être un paragraphe immersif
- Aucun champ ne peut être null ou vide

JSON STRICT:
{
  "title": "string",
  "intro": "string",
  "hidden_plot": "string",
  "secret_objective": "string",
  "hazard": "string",
  "chronicle": "string"
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
    const parsed = JSON.parse(data.choices[0].message.content);

if (!parsed || typeof parsed !== "object") {
  throw new Error("Scénario invalide");
}

const safeScenario = {
  title: parsed.title ?? quest.title ?? "Incursion Sans Nom",
  intro: parsed.intro ?? "Le destin refuse encore de se dévoiler.",
  hidden_plot: parsed.hidden_plot ?? null,
  secret_objective: parsed.secret_objective ?? null,
  hazard: parsed.hazard ?? "Zone initiale",
  chronicle: parsed.chronicle ?? "L'incursion commence."
};

res.json(safeScenario);

  } catch (e) {  
    console.error(e);
    res.status(500).json({ error: "L'Oracle est sourd." });  
  }  
});

/* ===================== PROGRESSION ===================== */
app.post("/quest/progress", async (req, res) => {
  const { player, quest, action } = req.body;

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

    const s = quest.stats || {};
    const ws = result.worldState || { hpLoss: 0, mp_psLoss: 0, endLoss: 0, newHazard: quest.hazard };

    const newStats = {
      ...s,
      hp: clamp(Number(s.hp ?? s.hpMax ?? 100) - Number(ws.hpLoss || 0), 0, Number(s.hpMax || 100)),
      mp_ps: clamp(Number(s.mp_ps ?? s.mp_psMax ?? 100) - Number(ws.mp_psLoss || 0), 0, Number(s.mp_psMax || 100)),
      endurance: clamp(Number(s.endurance ?? s.endMax ?? 100) - Number(ws.endLoss || 0), 0, Number(s.endMax || 100))
    };

    const updatedChronicle = `${chronicle}\n- Action: ${action} | Résultat: ${ws.newHazard || "Action effectuée"}`;

    const output = {
      narrative: result.narrative || "L'action s'accomplit.",
      newStats,
      progress: clamp(result.progress ?? quest.progress ?? 0, 0, 100),
      hazard: ws.newHazard || quest.hazard,
      secretFound: !!(ws.secretFound || quest.secretFound),
      isDead: !!(ws.isDead || (newStats.hp <= 0)),
      chronicle: updatedChronicle,
      flags: ws.flagsUpdated || flags
    };

    res.json(output);
  } catch (e) {
    console.error("ERREUR SERVEUR:", e.message);
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
        messages: [{ role: "system", content: "Tu es le juge final. Détermine si c'est un succès ou un échec." }, { role: "user", content: userPrompt }],
        response_format: { type: "json_object" }
      })
    });
    const data = await response.json();
    res.json(JSON.parse(data.choices[0].message.content));
  } catch (e) {
    res.status(500).json({ success: false, reason: "Erreur lors du dénouement." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Oracle V4.3 Operational"));