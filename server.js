import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

// Ordre des rangs pour calcul de puissance relative
const RANGS_ORDRE = ["F", "E", "D", "C", "B", "A", "S", "SS", "SSS", "Z", "XE"];

/**
 * Formate l'intégralité du profil pour l'IA avec focus sur les stats de combat
 */
const formatFullPlayerContext = (player, currentStats = null) => {
  const b = player.baseStats || {};
  const m = player.modifiers || {};
  const s = currentStats || b;

  return `
    --- PROFIL DU PERSONNAGE ---
    NOM: ${player.avatarName} | CLASSE: ${player.characterClass} | RANG: ${player.rank} | LVL: ${player.level}
    ATTRIBUTS: ${player.attributes?.join(", ")}
    
    UNITÉS VITALES ACTUELLES:
    HP: ${Math.ceil(s.hp)}/${s.hpMax || b.hp} | MP: ${Math.ceil(s.mp_ps || s.mp)}/${s.mpMax || b.mp_ps} | END: ${Math.ceil(s.endurance || s.end)}/${s.endMax || b.endurance}
    
    STATISTIQUES DE COMBAT PRÉCISES:
    - Agilité (PA): ${s.pa || (b.pa + (m.pa||0))} (Détermine esquive/réflexes)
    - Force/Puissance (PF): ${s.pf || (b.pf + (m.pf||0))} (Détermine dégâts/impact)
    - Maîtrise: ${s.mastery || (b.mastery + (m.mastery||0))} (Efficacité technique)
    - Vitesse: ${s.speed || (b.speed + (m.speed||0))} (Rapidité d'exécution)
    - Précision: ${s.precision || (b.precision + (m.precision||0))} (Chance de toucher/détection)
    - Volonté: ${s.willpower || (b.willpower + (m.willpower||0))} (Résistance mentale/mana)
    - Concentration: ${s.concentration || (b.concentration + (m.concentration||0))} (Stabilité des sorts)
    - Chance: ${s.luck || (b.luck + (m.luck||0))} (Facteur X/Critiques)
    
    COMPÉTENCES:
    ${player.uniqueSkills?.map(sk => `- ${sk.name}: ${sk.description}`).join("\n")}
  `;
};

/**
 * POST /quest/scenario
 */
app.post("/quest/scenario", async (req, res) => {
  const { player, quest, mode } = req.body;

  const systemPrompt = `
    Tu es l'Environnement et le Maître du Jeu.
    CONSIGNE DE RANG : Le joueur est rang ${player.rank} et la quête est rang ${quest.rank}. 
    Si le rang du joueur est supérieur, il doit se sentir surpuissant (ex: un rang S écrase un rang C sans effort, ses mouvements sont invisibles pour l'ennemi).
    Génère un "secret_objective" (scénario caché) qui, s'il est résolu, triple les récompenses.
    Réponds en JSON uniquement.
  `;

  const userPrompt = `
    CONTEXTE: ${formatFullPlayerContext(player)}
    ZONE: ${quest.zoneName}
    OBJECTIF: ${quest.task || quest.title}
    
    Génère l'intro:
    {
      "title": "Nom",
      "intro": "Description",
      "hidden_plot": "Le fil conducteur",
      "secret_objective": "Condition cachée (ex: trouver l'idole de cristal sans alerter les gardes)",
      "hazard": "Danger initial précis avec coordonnées ou repères visuels (ex: '3 golems à 20m au Nord')",
      "companion": ${mode === 'team' ? '{"name": "Kael", "role": "Guerrier"}' : 'null'}
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
    res.json(JSON.parse(data.choices[0].message.content));
  } catch (error) {
    res.status(500).json({ error: "L'Oracle est sourd." });
  }
});

/**
 * POST /quest/progress
 */
app.post("/quest/progress", async (req, res) => {
  const { player, quest, action } = req.body;

  const systemPrompt = `
    Tu es la LOGIQUE implacable du monde.
    
    RÈGLES DE CALCUL DES STATS :
    - ESQUIVE : Compare PA (Agilité) + Vitesse du joueur contre la Dangerosité de l'attaque. Si le joueur est de Rang S contre C, l'esquive est automatique sauf si l'action est absurde.
    - PUISSANCE : PF (Force) détermine si une attaque détruit l'ennemi. Un sort de zone avec un PF élevé doit raser la zone comme demandé.
    - CONSOMMATION MANA : Le coût en MP doit être précis. Un sort massif de rang S coûte cher, mais un petit sort pour un rang S ne coûte presque rien (0.1 MP).
    - DÉTECTION : Utilise la Précision et la Concentration pour donner des lieux EXACTS (ex: "Sous la cascade à 15m", pas "quelque part").
    - RÉACTION : Si l'ennemi attaque, décris le début de l'attaque et laisse le joueur décider de sa réaction si le temps (duration) le permet.
    
    RÈGLES DE PROGRESSION :
    - Si l'action remplit le "secret_objective", mentionne-le subtilement.
    - Progression logique : Tuer 1/15 golems = +7%.
  `;

  const userPrompt = `
    JOUEUR: ${formatFullPlayerContext(player, quest.stats)}
    OBJECTIF: ${quest.task} | SECRET: ${quest.secret_objective}
    DANGER ACTUEL: ${quest.hazard}
    ACTION DU JOUEUR: "${action}"

    Analyse l'action par rapport aux statistiques (PA, PF, Maîtrise, etc.) et au différentiel de Rang.
    
    Réponds en JSON:
    {
      "aiResponse": "Description spatiale et technique (lieux, noms, effets précis).",
      "newStats": { 
          "hp": nombre, "mp_ps": nombre, "endurance": nombre,
          "hpMax": ${quest.stats.hpMax}, "mpMax": ${quest.stats.mpMax}, "endMax": ${quest.stats.endMax},
          "pa": ${quest.stats.pa}, "pf": ${quest.stats.pf}, "mastery": ${quest.stats.mastery}, 
          "speed": ${quest.stats.speed}, "precision": ${quest.stats.precision}, 
          "luck": ${quest.stats.luck}, "concentration": ${quest.stats.concentration},
          "willpower": ${quest.stats.willpower}
      },
      "newProgress": nombre (0-100),
      "newHazard": "Description du nouvel état du monde après l'action",
      "secretFound": boolean (si le joueur a découvert/avancé le secret),
      "isDead": boolean
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

    // Sécurité : Maintenir les Max pour éviter le undefined
    result.newStats.hpMax = quest.stats.hpMax;
    result.newStats.mpMax = quest.stats.mpMax;
    result.newStats.endMax = quest.stats.endMax;

    res.json(result);
  } catch (error) {
    res.status(500).json({ aiResponse: "Le destin vacille." });
  }
});

/**
 * POST /quest/resolve
 */
app.post("/quest/resolve", async (req, res) => {
  const { player, quest } = req.body;

  const userPrompt = `
    FIN DE QUÊTE : ${quest.title}
    Progression : ${quest.progress}% | Secret trouvé : ${quest.secretFound ? 'OUI' : 'NON'}
    
    Calcule la conclusion. Si le secret a été trouvé, triple le gold.
    
    Réponds en JSON:
    {
      "success": boolean,
      "reason": "Texte de conclusion épique",
      "rewards": { 
        "gold": ${quest.secretFound ? quest.reward_gold * 3 : quest.reward_gold}, 
        "exp": ${quest.progress * 3} 
      }
    }
  `;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: "Le Juge des Ames." }, { role: "user", content: userPrompt }],
        response_format: { type: "json_object" }
      })
    });
    const data = await response.json();
    res.json(JSON.parse(data.choices[0].message.content));
  } catch (error) {
    res.status(500).json({ success: false, reason: "Incursion perdue." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Oracle V3.1 - Moteur de Simulation Précis`));