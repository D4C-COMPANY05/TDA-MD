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

  const systemPrompt = `Tu es un générateur de scénarios RPG.
Tu DOIS répondre UNIQUEMENT avec un objet JSON valide, sans texte avant ou après.
Format EXACT requis :
{
  "title": "string",
  "intro": "string",
  "hidden_plot": "string",
  "secret_objective": "string",
  "hazard": "string",
  "companion": null ou {"name": "string", "role": "string"}
}`;

  const userPrompt = `Joueur: ${player.avatarName}, Rang ${player.rank}, Classe ${player.characterClass}
Zone: ${quest.zoneName}
Objectif: ${quest.task || quest.title}
Mode: ${mode}

Crée un scénario immersif avec un titre accrocheur, une intro captivante de 2-3 phrases, un complot caché, un objectif secret, et un danger initial précis.
${mode === 'team' ? 'Inclus un compagnon avec nom et rôle.' : 'Mets companion à null.'}

Réponds UNIQUEMENT en JSON valide.`;

  try {
    console.log("🔵 === APPEL OPENAI ===");
    console.log("Prompt système:", systemPrompt);
    console.log("Prompt utilisateur:", userPrompt);
    
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, 
        "Content-Type": "application/json" 
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt }, 
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
        max_tokens: 800
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ ERREUR OPENAI:", response.status, errorText);
      throw new Error(`OpenAI error: ${response.status}`);
    }

    const data = await response.json();
    const rawContent = data.choices[0].message.content;
    
    console.log("🟢 === RÉPONSE BRUTE OPENAI ===");
    console.log(rawContent);
    console.log("=== TYPE:", typeof rawContent);
    console.log("=== LONGUEUR:", rawContent.length);
    console.log("================================");

    // Nettoyage strict
    let cleanContent = rawContent.trim();
    
    // Retirer les backticks markdown si présents
    if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      console.log("⚠️ Backticks détectés et retirés");
    }

    console.log("🔧 === CONTENU NETTOYÉ ===");
    console.log(cleanContent);
    console.log("===========================");

    // Parsing strict
    let parsedScenario;
    try {
      parsedScenario = JSON.parse(cleanContent);
      console.log("✅ JSON PARSÉ AVEC SUCCÈS:", parsedScenario);
    } catch (parseError) {
      console.error("❌ ERREUR DE PARSING:", parseError.message);
      console.error("Position de l'erreur:", parseError);
      throw new Error("JSON invalide reçu d'OpenAI");
    }

    // Validation stricte des champs
    const requiredFields = ['title', 'intro', 'hidden_plot', 'secret_objective', 'hazard'];
    const missingFields = requiredFields.filter(field => !parsedScenario[field]);
    
    if (missingFields.length > 0) {
      console.error("❌ CHAMPS MANQUANTS:", missingFields);
      throw new Error(`Champs manquants: ${missingFields.join(', ')}`);
    }

    // Construction du scénario final
    const scenario = {
      title: parsedScenario.title,
      intro: parsedScenario.intro,
      hidden_plot: parsedScenario.hidden_plot,
      secret_objective: parsedScenario.secret_objective,
      hazard: parsedScenario.hazard,
      companion: parsedScenario.companion || null
    };

    console.log("✅ === SCENARIO FINAL ENVOYÉ ===");
    console.log(JSON.stringify(scenario, null, 2));
    console.log("=================================");
    
    res.json(scenario);
    
  } catch (error) {
    console.error("❌❌❌ ERREUR CRITIQUE ❌❌❌");
    console.error(error);
    
    // Renvoyer l'erreur au client pour qu'il sache ce qui s'est passé
    res.status(500).json({ 
      error: "Échec de génération du scénario",
      details: error.message,
      suggestion: "Vérifiez les logs serveur pour plus de détails"
    });
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