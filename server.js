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

// ===== FORMAT PLAYER POUR L'IA =====
const formatPlayerContext = (player, currentStats = null) => {
  const b = player.baseStats || {};
  const m = player.modifiers || {};
  const s = currentStats || b;

  return `
NOM: ${player.avatarName} | CLASSE: ${player.characterClass} | RANG: ${player.rank} | LVL: ${player.level}
ATTRIBUTS: ${player.attributes?.join(", ") || "Aucun"}

STATS ACTUELLES:
HP: ${Math.ceil(s.hp)}/${s.hpMax || b.hp} | MP: ${Math.ceil(s.mp_ps || s.mp)}/${s.mpMax || b.mp_ps} | END: ${Math.ceil(s.endurance || s.end)}/${s.endMax || b.endurance}
PA: ${s.pa || (b.pa + (m.pa||0))} | PF: ${s.pf || (b.pf + (m.pf||0))} | Maîtrise: ${s.mastery || (b.mastery + (m.mastery||0))}
Vitesse: ${s.speed || (b.speed + (m.speed||0))} | Précision: ${s.precision || (b.precision + (m.precision||0))}

COMPÉTENCES AUTORISÉES:
${player.uniqueSkills?.map(sk => `- ${sk.name}: ${sk.description}`).join("\n") || "Aucune"}
  `;
};

// ===== SCÉNARIO =====
app.post("/quest/scenario", async (req, res) => {
  const { player, quest, mode } = req.body;

  const systemPrompt = `Tu es le GAME MASTER. Tu génères des scénarios de jeu avec des positions PRÉCISES et des compétences STRICTES. Réponds UNIQUEMENT en JSON.`;

  const userPrompt = `
JOUEUR: ${formatPlayerContext(player)}
ZONE: ${quest.zoneName}
OBJECTIF: ${quest.task || quest.title}

Génère un scénario de jeu avec:
1. Des positions EXACTES (Nord/Sud/Est/Ouest + distance en mètres)
2. Des compétences LIMITÉES avec coûts MP/END précis
3. Un danger initial CONCRET (ex: "3 Kobolds à 15m au Sud, 1 Golem à 8m à l'Est")

JSON ATTENDU:
{
  "title": "Nom court",
  "intro": "2-3 phrases directes, pas de blabla",
  "hidden_plot": "Fil rouge simple",
  "secret_objective": "Condition cachée claire",
  "hazard": "Position précise des ennemis/dangers (ex: '3 Kobolds à 15m Sud, 1 Golem 8m Est')",
  "skills": [
    {
      "name": "Nom exact de la compétence du joueur",
      "type": "attaque/défense/soutien/utilitaire",
      "portee": "mêlée/courte (0-10m)/moyenne (10-30m)/longue (30m+)",
      "cout": { "mp": nombre, "end": nombre },
      "effet": "Description concrète de l'effet (dégâts, zone, durée)",
      "limites": ["1 seule limite par ligne", "Ex: Cooldown 30 sec", "Ex: Max 3 cibles"],
      "scaling": { "stat": "PF/Maîtrise/PA", "coefficient": nombre }
    }
  ],
  "companion": ${mode === 'team' ? '{"name": "Allié", "role": "Rôle", "position": "5m derrière vous"}' : 'null'}
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
        temperature: 0.7 // Moins robotique
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

// ===== PROGRESS (LE PLUS IMPORTANT) =====
app.post("/quest/progress", async (req, res) => {
  const { player, quest, action, chronique } = req.body;

  let skillsToSend = [];
  if(action) {
    skillsToSend = quest.skills?.filter(sk => action.toLowerCase().includes(sk.name.toLowerCase())) || [];
  }

  const systemPrompt = `Tu es le GAME MASTER STRICT d'un MMO/FPS.

RÈGLES ABSOLUES:
1. Décris ce que le joueur VOIT (positions, distances, ennemis)
2. Applique les COÛTS EXACTS: mouvement = END, attaque = HP+END, sort = MP+END
3. REFUSE toute compétence non listée
4. Donne des résultats CONCRETS (ex: "-15 HP", "Kobold éliminé", "Échec, trop loin")
5. Mets à jour les positions après CHAQUE mouvement
6. Si le joueur dit "j'utilise 50% de mon MP", CALCULE et applique exactement

COÛTS STANDARDS:
- Marcher 10m: -5 END
- Courir 10m: -10 END
- Coup de poing: -3 HP (contre-attaque possible), -5 END
- Esquive: -8 END
- Sort mineur: -10 MP, -3 END
- Sort majeur: -30 MP, -10 END

STYLE DE RÉPONSE:
- Factuel, direct, pas de blabla
- Ex: "Tu avances de 8m vers le Nord. END -6. À 7m devant toi, 2 Kobolds chargent."
- Ex: "Boule de feu lancée. MP -25, END -8. Kobold touché: -40 HP, éliminé. Reste 1 Kobold à 12m Est."
`;

  const userPrompt = `
NARRATION PRÉCÉDENTE:
${chronique || "Début de la quête"}

JOUEUR ACTUEL:
${formatPlayerContext(player, quest.stats)}

OBJECTIF: ${quest.task}
SECRET: ${quest.secret_objective}
SITUATION: ${quest.hazard}

ACTION DU JOUEUR: "${action}"
COMPÉTENCES AUTORISÉES: ${skillsToSend.length > 0 ? JSON.stringify(skillsToSend) : "Aucune compétence détectée dans l'action"}

RÉPONDS EN JSON:
{
  "aiResponse": "Description FACTUELLE de ce qui se passe (positions, résultats, coûts appliqués)",
  "newStats": { 
    "hp": nombre EXACT après action, 
    "mp_ps": nombre EXACT après action, 
    "endurance": nombre EXACT après action 
  },
  "newProgress": nombre (0-100, augmente SEULEMENT si objectif avancé),
  "newHazard": "Position PRÉCISE des ennemis/dangers restants (ex: '1 Kobold 12m Est, blessé')",
  "secretFound": ${quest.secretFound ? 'true' : 'false (passe à true SEULEMENT si le joueur découvre le secret)'},
  "isDead": boolean (true si HP <= 0 OU MP <= 0 OU END <= 0)
}

IMPORTANT:
- Si compétence non autorisée → refuse l'action
- Si le joueur dit "50% de mon MP" → calcule ${Math.floor((quest.stats.mp_ps || 100) * 0.5)} exactement
- Applique TOUJOURS les coûts END pour les mouvements
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
        temperature: 0.6 // Précis mais pas robotique
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error("❌ ERREUR OpenAI:", data);
      return res.status(500).json({ 
        aiResponse: "Erreur serveur.", 
        details: data.error?.message 
      });
    }
    
    const result = JSON.parse(data.choices[0].message.content);
    console.log("✅ Action traitée:", action.substring(0, 50));
    
    res.json(result);

  } catch (error) {
    console.error("❌ ERREUR:", error.message);
    res.status(500).json({ aiResponse: "Le destin vacille.", details: error.message });
  }
});

// ===== FIN DE QUÊTE =====
app.post("/quest/resolve", async (req, res) => {
  const { player, quest } = req.body;

  const systemPrompt = `Tu es le JUGE FINAL. Évalue la performance du joueur de manière DIRECTE et JUSTE.`;

  const userPrompt = `
QUÊTE: ${quest.title}
Progression: ${quest.progress}%
Secret découvert: ${quest.secretFound ? "OUI" : "NON"}
HP final: ${quest.stats?.hp || 0}
MP final: ${quest.stats?.mp_ps || 0}
END final: ${quest.stats?.endurance || 0}

Critères de réussite:
- Progression >= 80% = succès
- Secret trouvé = x3 récompenses
- Mort (HP/MP/END <= 0) = échec automatique

JSON ATTENDU:
{
  "success": boolean,
  "reason": "1-2 phrases DIRECTES expliquant le résultat",
  "rewards": { 
    "gold": ${quest.secretFound ? (quest.reward_gold || 0) * 3 : (quest.reward_gold || 0)}, 
    "exp": ${Math.floor((quest.progress || 0) * 3)}
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
        temperature: 0.7
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      return res.status(500).json({ 
        success: false, 
        reason: "Erreur d'évaluation." 
      });
    }
    
    res.json(JSON.parse(data.choices[0].message.content));

  } catch (error) {
    res.status(500).json({ success: false, reason: "Erreur finale.", details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🎮 Oracle V4 - Game Master Mode ACTIF`));