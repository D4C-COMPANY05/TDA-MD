import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

const RANGS_ORDRE = ["F", "E", "D", "C", "B", "A", "S", "SS", "SSS", "Z", "XE"];

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
    - Agilité (PA): ${s.pa || (b.pa + (m.pa||0))}
    - Force/Puissance (PF): ${s.pf || (b.pf + (m.pf||0))}
    - Maîtrise: ${s.mastery || (b.mastery + (m.mastery||0))}
    - Vitesse: ${s.speed || (b.speed + (m.speed||0))}
    - Précision: ${s.precision || (b.precision + (m.precision||0))}
    - Volonté: ${s.willpower || (b.willpower + (m.willpower||0))}
    - Concentration: ${s.concentration || (b.concentration + (m.concentration||0))}
    - Chance: ${s.luck || (b.luck + (m.luck||0))}
    
    COMPÉTENCES:
    ${player.uniqueSkills?.map(sk => `- ${sk.name}: ${sk.description}`).join("\n")}
  `;
};

app.post("/quest/scenario", async (req, res) => {
  const { player, quest, mode } = req.body;

  const systemPrompt = `
    Tu es l'Environnement et le Maître du Jeu.
    CONSIGNE DE RANG : Le joueur est rang ${player.rank} et la quête est rang ${quest.rank}. 
    Si le rang du joueur est supérieur, il est écrasant de puissance.
    Génère un "secret_objective" (scénario caché).
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
      "secret_objective": "Condition cachée",
      "hazard": "Danger initial précis (ex: '3 golems à 20m au Nord')",
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

app.post("/quest/progress", async (req, res) => {
  const { player, quest, action } = req.body;

  // RÉCUPÉRATION DE L'HISTORIQUE (Journal) pour la mémoire
  const history = quest.journal ? quest.journal.slice(-6).map(j => `${j.type === 'player' ? 'Joueur' : 'Monde'}: ${j.text}`).join("\n") : "Aucun historique.";

  const systemPrompt = `
    Tu es la MÉMOIRE ET LA LOGIQUE du monde.
    
    IMPORTANT : Tu dois te souvenir des événements passés. Ne répète pas des dangers déjà éliminés ou des positions déjà atteintes.
    
    RÈGLES DE CALCUL :
    - ESQUIVE/RÉACTION : Utilise PA (Agilité) + Vitesse. Un rang S esquive presque tout d'un rang C.
    - PUISSANCE : PF (Force) détermine les dégâts massifs.
    - MANA : Consommation précise. Un sort mineur pour un rang S coûte 0.1 MP. Un sort de destruction massif coûte cher.
    - DÉTECTION : Utilise Précision/Concentration pour des lieux EXACTS.
    
    RÈGLES DE CONTINUITÉ :
    - Si le joueur a déjà vaincu ou contrôlé des ennemis dans le Nord, ne dis pas qu'ils y sont encore.
    - Si le joueur répand sa magie, décris ce qu'il perçoit au-delà de sa position actuelle.
  `;

  const userPrompt = `
    HISTORIQUE RÉCENT :
    ${history}

    JOUEUR ACTUEL: ${formatFullPlayerContext(player, quest.stats)}
    OBJECTIF : ${quest.task} | SECRET: ${quest.secret_objective}
    DANGER PRÉCÉDENT : ${quest.hazard}
    ACTION DU JOUEUR : "${action}"

    Réponds en JSON:
    {
      "aiResponse": "Description précise tenant compte de l'historique.",
      "newStats": { 
          "hp": nombre, "mp_ps": nombre, "endurance": nombre,
          "hpMax": ${quest.stats.hpMax}, "mpMax": ${quest.stats.mpMax}, "endMax": ${quest.stats.endMax},
          "pa": ${quest.stats.pa}, "pf": ${quest.stats.pf}, "mastery": ${quest.stats.mastery}, 
          "speed": ${quest.stats.speed}, "precision": ${quest.stats.precision}, 
          "luck": ${quest.stats.luck}, "concentration": ${quest.stats.concentration},
          "willpower": ${quest.stats.willpower}
      },
      "newProgress": nombre (0-100),
      "newHazard": "Nouvel état de l'environnement (ex: '2 golems détruits, 1 sous contrôle. Reste 12 golems dans la grotte à l'Est')",
      "secretFound": ${quest.secretFound || false},
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

    result.newStats.hpMax = quest.stats.hpMax;
    result.newStats.mpMax = quest.stats.mpMax;
    result.newStats.endMax = quest.stats.endMax;

    res.json(result);
  } catch (error) {
    res.status(500).json({ aiResponse: "Le destin vacille." });
  }
});

app.post("/quest/resolve", async (req, res) => {
  const { player, quest } = req.body;

  const userPrompt = `
    FIN DE QUÊTE : ${quest.title}
    Progression : ${quest.progress}% | Secret : ${quest.secretFound ? 'TROUVÉ' : 'NON'}
    
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
      headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: "Le Juge." }, { role: "user", content: userPrompt }],
        response_format: { type: "json_object" }
      })
    });
    const data = await response.json();
    res.json(JSON.parse(data.choices[0].message.content));
  } catch (error) {
    res.status(500).json({ success: false, reason: "Erreur finale." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Oracle V3.2 - Mémoire Active`));