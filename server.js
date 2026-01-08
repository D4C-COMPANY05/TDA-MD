import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

const RANGS_ORDRE = ["F", "E", "D", "C", "B", "A", "S", "SS", "SSS", "Z", "XE"];

const OPENAI_KEYS = [
  process.env.OPENAI_KEY_1,
  process.env.OPENAI_KEY_2,
  process.env.OPENAI_KEY_3,
];

// Fonction pour prendre une clé au hasard (ou round-robin)
let keyIndex = 0;
const getOpenAIKey = () => {
  const key = OPENAI_KEYS[keyIndex];
  keyIndex = (keyIndex + 1) % OPENAI_KEYS.length;
  return key;
};

// ===== FORMAT PLAYER POUR L'IA =====
const formatPlayerContext = (player, currentStats = null) => {
  const b = player.baseStats || {};
  const m = player.modifiers || {};
  const s = currentStats || b;

  return `
--- PROFIL DU PERSONNAGE ---
NOM: ${player.avatarName} | CLASSE: ${player.characterClass} | RANG: ${player.rank} | LVL: ${player.level}
ATTRIBUTS: ${player.attributes?.join(", ") || "Aucun"}

UNITÉS VITALES:
HP: ${Math.ceil(s.hp)}/${s.hpMax || b.hp} | MP: ${Math.ceil(s.mp_ps || s.mp)}/${s.mpMax || b.mp_ps} | END: ${Math.ceil(s.endurance || s.end)}/${s.endMax || b.endurance}

STATISTIQUES DE COMBAT:
PA: ${s.pa || (b.pa + (m.pa||0))} | PF: ${s.pf || (b.pf + (m.pf||0))} | Maîtrise: ${s.mastery || (b.mastery + (m.mastery||0))}
Vitesse: ${s.speed || (b.speed + (m.speed||0))} | Précision: ${s.precision || (b.precision + (m.precision||0))}
Volonté: ${s.willpower || (b.willpower + (m.willpower||0))} | Concentration: ${s.concentration || (b.concentration + (m.concentration||0))} | Chance: ${s.luck || (b.luck + (m.luck||0))}

COMPÉTENCES (description RP libre):
${player.uniqueSkills?.map(sk => `- ${sk.name}: ${sk.description}`).join("\n") || "Aucune"}
  `;
};

// ===== SCÉNARIO =====
app.post("/quest/scenario", async (req, res) => {
  const { player, quest, mode } = req.body;

  const systemPrompt = `
Tu es le Maître du Jeu. Tu transformes la description RP des compétences du joueur en compétences structurées MJ (limites, scaling, coûts) que tu utilises pour restreindre les actions. Réponds seulement en JSON.
`;

  const userPrompt = `
CONTEXTE JOUEUR: ${formatPlayerContext(player)}
ZONE: ${quest.zoneName}
OBJECTIF: ${quest.task || quest.title}
COMPAGNON: ${mode === 'team' ? '{"name": "Kael", "role": "Guerrier"}' : 'null'}

GÉNÈRE EN JSON:
{
  "title": "Nom",
  "intro": "Description introductive de la quête",
  "hidden_plot": "Fil conducteur du scénario",
  "secret_objective": "Condition cachée",
  "hazard": "Danger initial précis (ex: '3 golems à 20m au Nord')",
  "skills": [
    {
      "name": "Nom de la compétence",
      "type": "attaque/défense/soutien",
      "portee": "distance ou mêlée",
      "cout": { "mp": X, "end": Y },
      "effet": "Description effet",
      "limites": ["liste des limites selon jugement IA"],
      "scaling": { "stat": coefficient }
    }
  ]
}
`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${getOpenAIKey()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" }
      })
    });

    const data = await response.json();
    const parsedContent = JSON.parse(data.choices[0].message.content);

    // RENVOIE AU FRONT POUR ENREGISTREMENT DANS FIREBASE
    res.json(parsedContent);

  } catch (error) {
    res.status(500).json({ error: "Erreur scénario", details: error.message });
  }
});

// ===== PROGRESS =====
app.post("/quest/progress", async (req, res) => {
  const { player, quest, action, chronique } = req.body;

  let skillsToSend = [];
if(action) {
  skillsToSend = quest.skills?.filter(sk => action.toLowerCase().includes(sk.name.toLowerCase())) || [];
}
  const systemPrompt = `
Tu es la MÉMOIRE et la LOGIQUE du monde.
Règles:
- Esquive: PA + Vitesse
- Dégâts: PF et scaling des compétences
- Vérifie limites des compétences
- Ne répète pas les dangers déjà résolus
- L'action du joueur doit être valide selon stats et compétences
`;

  const userPrompt = `
CHRONIQUE: ${chronique || "Aucun"}
JOUEUR: ${formatPlayerContext(player, quest.stats)}
OBJECTIF: ${quest.task}
SECRET: ${quest.secret_objective}
DANGER PRÉCÉDENT: ${quest.hazard}
ACTION: "${action}"
COMPÉTENCES DISPONIBLES: ${JSON.stringify(skillsToSend)}

Réponds en JSON:
{
  "aiResponse": "Description précise prenant en compte la chronique et la compétence",
  "newStats": { "hp": nombre, "mp_ps": nombre, "endurance": nombre },
  "newProgress": nombre (0-100),
  "newHazard": "Nouvel état de l'environnement",
  "secretFound": boolean,
  "isDead": boolean
}
`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${getOpenAIKey()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" }
      })
    });

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);

    res.json(result);

  } catch (error) {
    res.status(500).json({ aiResponse: "Le destin vacille.", details: error.message });
  }
});

// ===== FIN DE QUÊTE =====
app.post("/quest/resolve", async (req, res) => {
  const { player, quest } = req.body;

  const userPrompt = `
FIN DE QUÊTE: ${quest.title}
Progression: ${quest.progress}% | Secret: ${quest.secretFound ? "TROUVÉ" : "NON"}

Réponds en JSON:
{
  "success": boolean,
  "reason": "Texte de conclusion",
  "rewards": { "gold": ${quest.secretFound ? quest.reward_gold * 3 : quest.reward_gold}, "exp": ${quest.progress * 3} }
}
`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${getOpenAIKey()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Le Juge." },
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" }
      })
    });

    const data = await response.json();
    res.json(JSON.parse(data.choices[0].message.content));

  } catch (error) {
    res.status(500).json({ success: false, reason: "Erreur finale.", details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Oracle V4 - Mémoire et Chronique Active`));