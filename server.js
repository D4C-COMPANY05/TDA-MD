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

let keyIndex = 0;
const getOpenAIKey = () => {
  const key = OPENAI_KEYS[keyIndex];
  keyIndex = (keyIndex + 1) % OPENAI_KEYS.length;
  return key;
};

const formatPlayerContext = (player, currentStats = null) => {
  const b = player.baseStats || {};
  const m = player.modifiers || {};
  const s = currentStats || b;

  return `
NOM: ${player.avatarName} | CLASSE: ${player.characterClass} | RANG: ${player.rank} | LVL: ${player.level}
ATTRIBUTS: ${player.attributes?.join(", ") || "Aucun"}

UNITÉS VITALES:
HP: ${Math.ceil(s.hp)}/${s.hpMax || b.hp} | MP: ${Math.ceil(s.mp_ps || s.mp)}/${s.mpMax || b.mp_ps} | END: ${Math.ceil(s.endurance || s.end)}/${s.endMax || b.endurance}

STATS COMBAT:
PA: ${s.pa || (b.pa + (m.pa||0))} | PF: ${s.pf || (b.pf + (m.pf||0))} | Maîtrise: ${s.mastery || (b.mastery + (m.mastery||0))}
Vitesse: ${s.speed || (b.speed + (m.speed||0))} | Précision: ${s.precision || (b.precision + (m.precision||0))}

COMPÉTENCES:
${player.uniqueSkills?.map(sk => `- ${sk.name}: ${sk.description}`).join("\n") || "Aucune"}
  `;
};

// ===== SCÉNARIO =====
app.post("/quest/scenario", async (req, res) => {
  const { player, quest, mode } = req.body;

  const systemPrompt = `Tu es un Maître du Jeu expérimenté qui raconte des histoires immersives.

STYLE D'ÉCRITURE:
- Écris comme un narrateur humain, pas comme une IA
- Utilise des phrases courtes et percutantes
- Évite les formulations robotiques ("il semblerait que", "vous pourriez", etc.)
- Sois direct et concret
- Utilise le présent de narration pour l'immersion

EXEMPLE BON:
"Tu te tiens à l'orée de la Forêt Maudite. Le brouillard rampe entre les arbres tordus. Trois silhouettes se dessinent à une vingtaine de mètres - des kobolds de sang, reconnaissables à leurs crocs dégouttants. Ils ne t'ont pas encore repéré."

EXEMPLE MAUVAIS:
"Vous vous trouvez maintenant devant ce qui semble être une forêt inquiétante. Il semblerait que des créatures hostiles soient présentes dans les environs. Vous pourriez probablement les affronter si vous le souhaitez."

Transforme les compétences RP du joueur en compétences structurées avec limites claires. Réponds UNIQUEMENT en JSON valide.`;

  const userPrompt = `
CONTEXTE: ${formatPlayerContext(player)}
ZONE: ${quest.zoneName}
OBJECTIF: ${quest.task || quest.title}
COMPAGNON: ${mode === 'team' ? 'Kael (Guerrier)' : 'Aucun'}

GÉNÈRE:
{
  "title": "Titre court et percutant (3-5 mots max)",
  "intro": "Description immersive en 2-3 phrases courtes. Décris ce que le personnage VOIT, ENTEND, SENT. Sois concret et précis sur les distances et positions des ennemis si présents. Utilise le présent.",
  "hidden_plot": "Le fil rouge caché du scénario",
  "secret_objective": "Une condition spéciale et mesurable (ex: 'Sauver les otages', 'Ne pas être détecté', 'Finir en moins de 5 minutes')",
  "hazard": "Danger PRÉCIS avec position et distance (ex: '3 kobolds à 18m au sud, 1 golem à 40m à l'est')",
  "skills": [
    {
      "name": "Nom exact de la compétence du joueur",
      "type": "attaque/défense/soutien/utilitaire",
      "portee": "corps-à-corps/10m/30m/50m/100m",
      "cout": { "mp": X, "end": Y },
      "effet": "Effet concret en 1 phrase",
      "limites": ["limite 1", "limite 2"],
      "scaling": { "stat principale": coefficient }
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
        response_format: { type: "json_object" },
        temperature: 0.8 // Plus créatif et naturel
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
    console.error("❌ Erreur scénario:", error.message);
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

  const systemPrompt = `Tu es un Maître du Jeu qui narre les conséquences des actions du joueur.

RÈGLES ABSOLUES:
1. DÉCRIS LES RÉSULTATS CONCRETS des actions, pas les intentions
2. DONNE DES DISTANCES ET POSITIONS PRÉCISES pour tout ce qui est visible
3. ÉCRIS AU PRÉSENT, comme si ça se déroulait maintenant
4. SOIS DIRECT: pas de "tu pourrais", "il semblerait", juste ce qui SE PASSE
5. Si le joueur attaque → Décris l'impact, les dégâts, la réaction de la cible
6. Si le joueur se déplace → Décris SA NOUVELLE POSITION et ce qu'il VOIT DE LÀ
7. Si le joueur utilise une compétence → Décris l'effet VISUEL et le résultat MÉCANIQUE

CALCULS:
- Esquive réussie si: (PA + Vitesse du joueur) > (Vitesse ennemie × 1.2)
- Dégâts = PF × scaling de la compétence × (Maîtrise/100)
- Coût en MP/END selon la compétence utilisée
- Un rang S domine complètement un rang C ou inférieur

STYLE:
❌ MAUVAIS: "Tu tentes de frapper le kobold. Il semble être blessé. Tu pourrais peut-être continuer."
✅ BON: "Ton poing s'écrase sur le crâne du kobold. CRAC. Il s'effondre, mort. Les deux autres à 12m grognent et chargent vers toi."

❌ MAUVAIS: "Tu avances vers le nord. Il y a des ennemis quelque part."
✅ BON: "Tu avances de 15m vers le nord. Devant toi, à 8m: un golem de pierre, immobile. À ta gauche (20m): deux kobolds qui fouillent des cadavres."`;

  const userPrompt = `
CHRONIQUE PRÉCÉDENTE:
${chronique || "Début de la quête"}

JOUEUR: ${formatPlayerContext(player, quest.stats)}
OBJECTIF: ${quest.task}
SECRET À DÉCOUVRIR: ${quest.secret_objective}
ÉTAT ACTUEL: ${quest.hazard}

ACTION DU JOUEUR: "${action}"
COMPÉTENCE(S) UTILISÉE(S): ${skillsToSend.length > 0 ? JSON.stringify(skillsToSend) : "Aucune (action simple)"}

RÉPONDS EN JSON:
{
  "aiResponse": "Narration au présent, 2-4 phrases max. Décris le RÉSULTAT de l'action avec distances précises. Si combat: donne les dégâts exacts. Si déplacement: donne la nouvelle position et ce qui est visible.",
  "newStats": { 
    "hp": nombre exact après l'action, 
    "mp_ps": nombre exact après coût, 
    "endurance": nombre exact après coût 
  },
  "newProgress": nombre entre 0 et 100 (augmente seulement si objectif avance),
  "newHazard": "État ACTUEL avec positions précises (ex: '1 kobold mort, 2 autres à 12m qui chargent, golem à 40m immobile')",
  "secretFound": true si condition secrète remplie, sinon false,
  "isDead": true si HP ≤ 0 ou MP ≤ 0
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
        response_format: { type: "json_object" },
        temperature: 0.7
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error("❌ ERREUR OpenAI:", data);
      return res.status(500).json({ 
        aiResponse: "L'Oracle est troublé...", 
        details: data.error?.message 
      });
    }

    const result = JSON.parse(data.choices[0].message.content);

    // Sécurité: garde les max stats
    result.newStats.hpMax = quest.stats.hpMax;
    result.newStats.mpMax = quest.stats.mpMax;
    result.newStats.endMax = quest.stats.endMax;

    res.json(result);

  } catch (error) {
    console.error("❌ Erreur progress:", error.message);
    res.status(500).json({ 
      aiResponse: "Le destin vacille.", 
      details: error.message 
    });
  }
});

// ===== FIN DE QUÊTE =====
app.post("/quest/resolve", async (req, res) => {
  const { player, quest } = req.body;

  const systemPrompt = `Tu es un Maître du Jeu qui conclut une aventure.

STYLE: Écris une conclusion immersive en 2-3 phrases. Pas de langue de bois, sois direct.

❌ MAUVAIS: "Votre quête s'est avérée être un succès remarquable grâce à vos efforts."
✅ BON: "Tu ressors de la forêt, couvert de sang et de gloire. Les villageois t'acclament. Tu es un héros."`;

  const userPrompt = `
FIN DE QUÊTE: ${quest.title}
Progression: ${quest.progress}%
Secret trouvé: ${quest.secretFound ? "OUI" : "NON"}
État final: ${quest.hazard}

Détermine si c'est un succès (progress = 100% obligatoire).

RÉPONDS EN JSON:
{
  "success": true/false,
  "reason": "Conclusion narrative en 2-3 phrases max, style direct",
  "rewards": { 
    "gold": ${quest.secretFound ? quest.reward_gold * 3 : quest.reward_gold}, 
    "exp": ${Math.floor(quest.progress * 3)} 
  }
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
        response_format: { type: "json_object" },
        temperature: 0.8
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      return res.status(500).json({ 
        success: false, 
        reason: "L'Oracle est silencieux." 
      });
    }

    res.json(JSON.parse(data.choices[0].message.content));

  } catch (error) {
    console.error("❌ Erreur resolve:", error.message);
    res.status(500).json({ 
      success: false, 
      reason: "L'incursion s'achève dans le chaos.", 
      details: error.message 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔮 Oracle V4 - MJ Immersif Actif`));