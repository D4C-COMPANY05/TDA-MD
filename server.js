import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

/**
 * Formate l'intégralité du profil Firestore pour l'IA
 * Inclut Base Stats, Modifiers, Attributs et Compétences
 */
const formatFullPlayerContext = (player, currentStats = null) => {
  const b = player.baseStats || {};
  const m = player.modifiers || {};
  const s = currentStats || b; // Utilise les stats de l'incursion si disponibles

  return `
    --- PROFIL DU PERSONNAGE ---
    NOM: ${player.avatarName} | CLASSE: ${player.characterClass} | RANG: ${player.rank} | NIVEAU: ${player.level}
    RACE: ${player.races?.join("/")} | ATTRIBUTS: ${player.attributes?.join(", ")}
    
    STATS ACTUELLES (Incursion):
    HP: ${Math.ceil(s.hp)}/${b.hp} | MP: ${Math.ceil(s.mp_ps || s.mp)}/${b.mp_ps} | END: ${Math.ceil(s.endurance || s.end)}/${b.endurance}
    
    CAPACITÉS DE COMBAT (Base + Mod):
    Puissance (PA): ${b.pa} (+${m.pa}) | Maîtrise: ${b.mastery} (+${m.mastery}) | Vitesse: ${b.speed} (+${m.speed})
    Précision: ${b.precision} (+${m.precision}) | Volonté: ${b.willpower} (+${m.willpower}) | Chance: ${b.luck} (+${m.luck})
    Concentration: ${b.concentration} (+${m.concentration}) | Puissance Magique (PF): ${b.pf} (+${m.pf})
    
    COMPÉTENCES UNIQUES:
    ${player.uniqueSkills?.map(sk => `- ${sk.name}: ${sk.description}`).join("\n")}
  `;
};

/**
 * POST /quest/scenario
 */
app.post("/quest/scenario", async (req, res) => {
  const { player, quest, mode } = req.body;

  const systemPrompt = `
    Tu es l'Environnement et le Maître du Jeu d'un RPG Dark Fantasy. 
    Tu ne scripts pas la défaite du joueur. Tu simules un monde réactif et logique.
    Si un Marionnettiste contrôle un ennemi et se cache, les autres ennemis doivent logiquement chercher la source ou combattre la marionnette, ils ne "devinent" pas où est le joueur sans raison.
    Réponds uniquement en JSON.
  `;

  const userPrompt = `
    CONTEXTE COMPLET: ${formatFullPlayerContext(player)}
    ZONE: ${quest.zoneName}
    OBJECTIF DE QUÊTE: ${quest.task || quest.title}
    
    Génère l'introduction.
    {
      "title": "Nom de l'incursion",
      "intro": "Description de l'environnement immédiat.",
      "hidden_plot": "La vérité cachée ou le danger tapis.",
      "hazard": "L'obstacle ou l'ennemi initial précis.",
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
    res.status(500).json({ error: "L'Oracle est indisponible." });
  }
});

/**
 * POST /quest/progress
 * Logique de simulation stricte
 */
app.post("/quest/progress", async (req, res) => {
  const { player, quest, action } = req.body;

  const systemPrompt = `
    Tu es la LOGIQUE du monde. 
    RÈGLES STRICTES :
    1. Si HP <= 0 OU (MP <= 0 pour un mage/marionnettiste), le joueur ÉCHOUE immédiatement.
    2. L'Endurance (END) diminue proportionnellement aux efforts physiques.
    3. Le Mana (MP) diminue selon la complexité des sorts ou contrôles.
    4. Progression : N'augmente le "newProgress" QUE si l'action rapproche réellement de l'objectif ("${quest.task}"). Une action de survie pure n'augmente pas la progression.
    5. Cohérence : Si le joueur est caché ou utilise une stratégie valide (marionnette), l'ennemi doit réagir logiquement à la marionnette, pas au joueur invisible.
  `;

  const userPrompt = `
    JOUEUR: ${formatFullPlayerContext(player, quest.stats)}
    INTRIGUE: ${quest.hidden_plot}
    DANGER: ${quest.hazard}
    PROGRESSION: ${quest.progress}%
    ACTION: "${action}"

    Réponds en JSON:
    {
      "aiResponse": "Description réaliste et brutale.",
      "newStats": { 
          "hp": nombre, "mp_ps": nombre, "endurance": nombre,
          "pa": ${quest.stats.pa}, "mastery": ${quest.stats.mastery}, "speed": ${quest.stats.speed},
          "precision": ${quest.stats.precision}, "luck": ${quest.stats.luck}, "concentration": ${quest.stats.concentration}
      },
      "newProgress": nombre (0-100),
      "newHazard": "Situation suivante",
      "isDead": boolean (true si HP ou MP sont à 0)
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
    
    // Sécurité serveur : Forcer l'échec si mort
    if (result.newStats.hp <= 0 || result.newStats.mp_ps <= 0) {
        result.isDead = true;
        result.aiResponse += " Vos forces vous abandonnent totalement. C'est la fin.";
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ aiResponse: "Erreur de synchronisation avec le destin." });
  }
});

/**
 * POST /quest/resolve
 */
app.post("/quest/resolve", async (req, res) => {
  const { player, quest } = req.body;

  const userPrompt = `
    FIN DE QUÊTE : ${quest.title}
    Progression finale : ${quest.progress}%
    Stats finales : HP:${quest.stats.hp}, MP:${quest.stats.mp_ps}

    DÉCISION :
    - Succès si progression == 100%.
    - Échec si HP <= 0 ou MP <= 0 ou progression < 100%.
    
    Réponds en JSON:
    {
      "success": boolean,
      "reason": "Texte de conclusion",
      "rewards": { "gold": ${quest.reward_gold}, "exp": ${quest.progress * 2} }
    }
  `;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: "Tu es le Juge Céleste." }, { role: "user", content: userPrompt }],
        response_format: { type: "json_object" }
      })
    });
    const data = await response.json();
    res.json(JSON.parse(data.choices[0].message.content));
  } catch (error) {
    res.status(500).json({ success: false, reason: "Incursion interrompue." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Oracle V3 opérationnel sur ${PORT}`));