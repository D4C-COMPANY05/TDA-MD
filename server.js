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
Tu es un Maître du Jeu expérimenté. Ton style est naturel, immersif, sans être fleuri.
Tu décris ce que le personnage VOIT, ENTEND, RESSENT - pas ce qu'il pense.
Tu transformes les compétences RP en règles techniques (coûts, limites, scaling).
Réponds uniquement en JSON valide.
`;

  const userPrompt = `
JOUEUR: ${player.avatarName} (${player.characterClass}, Rang ${player.rank})
COMPÉTENCES RP:
${player.uniqueSkills?.map(sk => `- ${sk.name}: ${sk.description}`).join("\n") || "Aucune"}

ZONE: ${quest.zoneName}
OBJECTIF: ${quest.task || quest.title}
MODE: ${mode === 'team' ? 'En équipe avec Kael (Guerrier)' : 'Solo'}

Génère l'introduction de la quête en JSON:
{
  "title": "Titre court et percutant",
  "intro": "2-3 phrases décrivant ce que le personnage voit/entend en arrivant. Ton neutre de MJ.",
  "hidden_plot": "Le fil narratif caché (1 phrase)",
  "secret_objective": "Condition secrète de succès parfait",
  "hazard": "Situation initiale précise (ex: '3 golems de pierre patrouillent à 30m, dos tourné')",
  "skills": [
    {
      "name": "Nom exact de la compétence",
      "type": "attaque/défense/soutien/utilitaire",
      "portee": "mêlée/courte (0-10m)/moyenne (10-30m)/longue (30m+)",
      "cout": { "mp": nombre, "end": nombre },
      "effet": "Effet mécanique concret (dégâts, durée, zone...)",
      "limites": ["Contraintes réelles basées sur la description RP"],
      "scaling": { "stat principale": "coefficient (ex: 1.5x PF)" }
    }
  ]
}

IMPORTANT: L'intro décrit UNIQUEMENT ce qui est visible/audible, pas les pensées du personnage.
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
        response_format: { type: "json_object" },
        temperature: 0.7 // Un peu de variété tout en restant cohérent
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error("❌ ERREUR OpenAI:", data);
      return res.status(500).json({ 
        error: "Erreur OpenAI", 
        details: data.error?.message || "Inconnue"
      });
    }

    const parsedContent = JSON.parse(data.choices[0].message.content);
    console.log("✅ Scénario généré:", parsedContent.title);
    
    res.json(parsedContent);

  } catch (error) {
    console.error("❌ ERREUR:", error.message);
    res.status(500).json({ error: "Erreur scénario", details: error.message });
  }
});

// ===== PROGRESS =====
app.post("/quest/progress", async (req, res) => {
  const { player, quest, action, chronique } = req.body;

  let skillsToSend = [];
  if(action) {
    skillsToSend = quest.skills?.filter(sk => 
      action.toLowerCase().includes(sk.name.toLowerCase())
    ) || [];
  }

  const systemPrompt = `
Tu es l'ENVIRONNEMENT et le système de jeu. Tu décris les CONSÉQUENCES des actions, pas les intentions.

RÈGLES STRICTES:
1. Décris UNIQUEMENT ce qui est perceptible (vue, ouïe, toucher, odeur)
2. Ne décris JAMAIS les pensées ou sensations internes du joueur
3. Donne des résultats CONCRETS et MESURABLES
4. Si le joueur utilise une compétence de détection, décris ce qu'il découvre
5. Calcule les dégâts/effets selon les stats et compétences
6. Vérifie les limites des compétences avant d'accepter l'action

CALCULS:
- Esquive/Réaction: PA + Vitesse
- Dégâts physiques: PF × scaling de la compétence
- Dégâts magiques: Mastery × scaling
- Coûts: Déduis MP/END selon la compétence utilisée

TON: Neutre, factuel, comme un MJ qui décrit l'environnement.
`;

  const userPrompt = `
=== CHRONIQUE PRÉCÉDENTE ===
${chronique || "Début de l'aventure"}

=== ÉTAT ACTUEL ===
${formatPlayerContext(player, quest.stats)}
OBJECTIF: ${quest.task}
OBJECTIF SECRET: ${quest.secret_objective}
SITUATION: ${quest.hazard}

=== ACTION DU JOUEUR ===
"${action}"

${skillsToSend.length > 0 ? `
=== COMPÉTENCE(S) UTILISÉE(S) ===
${skillsToSend.map(sk => `
- ${sk.name} (${sk.type}, ${sk.portee})
  Coût: ${sk.cout.mp || 0} MP, ${sk.cout.end || 0} END
  Effet: ${sk.effet}
  Limites: ${sk.limites.join(', ')}
  Scaling: ${JSON.stringify(sk.scaling)}
`).join('\n')}
` : ''}

Réponds en JSON:
{
  "aiResponse": "Décris CE QUI SE PASSE concrètement (pas ce que le joueur ressent). Ton MJ neutre. 2-4 phrases max.",
  "newStats": { 
    "hp": ${quest.stats.hp},
    "mp_ps": ${quest.stats.mp_ps},
    "endurance": ${quest.stats.endurance}
  },
  "newProgress": ${quest.progress || 0},
  "newHazard": "Nouvelle situation précise de l'environnement",
  "secretFound": ${quest.secretFound || false},
  "isDead": false
}

EXEMPLES DE BON TON:
✅ "La boule de feu explose sur le golem. Sa carapace se fissure, révélant un noyau lumineux. Il pivote vers vous en grognant."
✅ "Vous esquivez le coup. La massue fracasse le sol à 30cm de vous, projetant des débris."
✅ "Votre sort de détection révèle 5 signatures magiques derrière le mur nord, à 15m."

EXEMPLES DE MAUVAIS TON:
❌ "Vous sentez l'adrénaline monter alors que vous esquivez avec grâce..."
❌ "Un frisson parcourt votre échine en découvrant..."
❌ "Vous vous demandez si cette action était sage..."
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
        response_format: { type: "json_object" },
        temperature: 0.6 // Légèrement plus déterministe pour la cohérence
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ ERREUR OpenAI:", data);
      return res.status(500).json({ 
        aiResponse: "L'environnement ne répond pas.", 
        details: data.error?.message 
      });
    }

    const result = JSON.parse(data.choices[0].message.content);

    // Forcer la conservation des max stats
    result.newStats.hpMax = quest.stats.hpMax;
    result.newStats.mpMax = quest.stats.mpMax;
    result.newStats.endMax = quest.stats.endMax;

    console.log("✅ Action traitée, progression:", result.newProgress);

    res.json(result);

  } catch (error) {
    console.error("❌ ERREUR:", error.message);
    res.status(500).json({ 
      aiResponse: "Le destin vacille.", 
      details: error.message 
    });
  }
});

// ===== FIN DE QUÊTE =====
app.post("/quest/resolve", async (req, res) => {
  const { player, quest } = req.body;

  const systemPrompt = `
Tu es le juge final d'une quête. Ton verdict est sobre et factuel.
Pas de dramatisation excessive, juste les faits.
`;

  const userPrompt = `
QUÊTE: ${quest.title}
PROGRESSION: ${quest.progress}%
OBJECTIF SECRET: ${quest.secretFound ? "Accompli" : "Non découvert"}

Conclusion en JSON:
{
  "success": ${quest.progress >= 70 ? 'true' : 'false'},
  "reason": "2-3 phrases sobres expliquant pourquoi c'est un succès/échec. Ton de compte-rendu militaire.",
  "rewards": { 
    "gold": ${quest.secretFound ? quest.reward_gold * 3 : quest.reward_gold}, 
    "exp": ${Math.floor(quest.progress * 3)} 
  }
}

EXEMPLES:
✅ "Objectif rempli. Les golems sont neutralisés et l'artefact récupéré. Mission terminée sans pertes."
✅ "Échec partiel. Le noyau a été détruit mais deux golems se sont échappés. Zone non sécurisée."
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
        response_format: { type: "json_object" },
        temperature: 0.5
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      return res.status(500).json({ 
        success: false, 
        reason: "Erreur d'évaluation.", 
        details: data.error?.message 
      });
    }

    res.json(JSON.parse(data.choices[0].message.content));

  } catch (error) {
    res.status(500).json({ 
      success: false, 
      reason: "Erreur finale.", 
      details: error.message 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Oracle V4 - Mémoire et Chronique Active`));