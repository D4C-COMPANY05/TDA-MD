import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

// Ordre des rangs pour le calcul de puissance
const RANK_VALUES = { "F": 1, "E": 2, "D": 3, "C": 4, "B": 5, "A": 6, "S": 7, "SS": 8, "SSS": 9, "Z": 10, "XE": 11 };

/**
 * Formate le contexte pour l'IA avec une insistance sur les stats secondaires
 */
const formatFullPlayerContext = (player, currentStats = null) => {
  const b = player.baseStats || {};
  const m = player.modifiers || {};
  const s = currentStats || b;

  return `
    --- PROFIL DU PERSONNAGE ---
    NOM: ${player.avatarName} | RANG: ${player.rank} (Valeur: ${RANK_VALUES[player.rank] || 1})
    CLASSE: ${player.characterClass} | ATTRIBUTS: ${player.attributes?.join(", ")}
    
    ÉTAT ACTUEL:
    PV: ${Math.ceil(s.hp)}/${s.hpMax || b.hp} | MP: ${Math.ceil(s.mp_ps || s.mp)}/${s.mpMax || b.mp_ps} | END: ${Math.ceil(s.endurance || s.end)}/${s.endMax || b.endurance}
    
    STATISTIQUES DE COMBAT (Niveau Réel):
    - Agilité (PA): ${s.pa || (b.pa + (m.pa || 0))} -> Détermine l'esquive et la réactivité.
    - Force (PF): ${s.pf || (b.pf + (m.pf || 0))} -> Détermine la puissance physique brute.
    - Maîtrise: ${s.mastery || (b.mastery + (m.mastery || 0))} -> Réduit la consommation de MP et augmente le contrôle.
    - Vitesse: ${s.speed || (b.speed + (m.speed || 0))} -> Vitesse de déplacement et d'exécution.
    - Précision: ${s.precision || (b.precision + (m.precision || 0))} -> Chance de toucher les points vitaux.
    - Volonté: ${s.willpower || (b.willpower + (m.willpower || 0))} -> Résistance mentale et debuffs.
    - Concentration: ${s.concentration || (b.concentration || 0)} -> Détection et maintien des sorts complexes.
    - Chance: ${s.luck || (b.luck || 0)} -> Événements imprévus favorables.

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
    Tu es le Maître du Monde. 
    1. Si le joueur est de Rang S et la quête de Rang C, il est un DIEU parmi les mortels. Ses actions de base ne lui coûtent presque rien.
    2. Sois précis spatialement (distances en mètres, directions cardinales).
    3. Génère un "side_objective" secret qui n'est pas révélé au joueur mais qui peut être découvert par l'action.
    Réponds en JSON.
  `;

  const userPrompt = `
    JOUEUR: ${formatFullPlayerContext(player)}
    QUÊTE: ${quest.task} (Rang: ${quest.rank})
    ZONE: ${quest.zoneName}
    
    Génère l'intro:
    {
      "title": "Nom",
      "intro": "Description immersive et spatiale.",
      "hidden_plot": "Le secret de la zone.",
      "side_objective": "Condition secrète pour une récompense massive.",
      "hazard": "Le premier défi précis (ex: 3 golems à 20m au Nord).",
      "companion": ${mode === 'team' ? '{"name": "Kael", "role": "Tank"}' : 'null'}
    }
  `;

  try {
    const response = await fetch("https://api.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=" + process.env.GEMINI_API_KEY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: `System: ${systemPrompt}\n\nUser: ${userPrompt}` }] }],
            generationConfig: { responseMimeType: "application/json" }
        })
    });
    const data = await response.json();
    res.json(JSON.parse(data.candidates[0].content.parts[0].text));
  } catch (error) {
    res.status(500).json({ error: "L'Oracle est indisponible." });
  }
});

/**
 * POST /quest/progress
 */
app.post("/quest/progress", async (req, res) => {
  const { player, quest, action } = req.body;

  const playerRankVal = RANK_VALUES[player.rank] || 1;
  const questRankVal = RANK_VALUES[quest.rank] || 1;
  const diff = playerRankVal - questRankVal;

  const systemPrompt = `
    Tu es la LOGIQUE implacable.
    - ÉVALUATION DES STATS : 
        * Esquive : Compare PA (Agilité) + Vitesse du joueur vs Danger. Si Rang Joueur > Rang Quête, l'esquive est presque automatique.
        * Mana : La Maîtrise et la Concentration réduisent le coût. Un Rang S lançant un sort de Rang C consomme 1% de son mana.
        * Détection : Utilise la Concentration. Si le joueur cherche, donne des coordonnées précises.
    - RÈGLE D'OR : Ne force pas de dégâts si le scénario du joueur (esquive, barrière) est logique et que ses stats sont supérieures.
    - RÉACTIVITÉ : Si le joueur écrit une réaction à une attaque, juge si son PA/Vitesse permet d'éviter l'impact.
  `;

  const userPrompt = `
    CONTEXTE JOUEUR: ${formatFullPlayerContext(player, quest.stats)}
    DIFFÉRENCE DE RANG: ${diff} (Positif = Joueur plus fort)
    DANGER ACTUEL: ${quest.hazard}
    OBJECTIF SECRETS: ${quest.side_objective}
    ACTION DU JOUEUR: "${action}"

    Instructions JSON:
    1. aiResponse: Sois précis. Si le joueur détecte, dis: "À 12m sous les débris à l'Est, une lueur pourpre..."
    2. newStats: Calcule la perte de MP/END selon l'effort. (Négligeable si diff > 2).
    3. isSideObjectiveFound: true si l'action découvre le secret.
    
    {
      "aiResponse": "...",
      "newStats": { "hp": num, "mp_ps": num, "endurance": num, "pa": num, "pf": num, "mastery": num, "speed": num, "precision": num, "luck": num, "concentration": num, "willpower": num },
      "newProgress": num (0-100),
      "newHazard": "Prochaine situation précise",
      "isSideObjectiveFound": boolean,
      "isDead": boolean
    }
  `;

  try {
    const response = await fetch("https://api.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=" + process.env.GEMINI_API_KEY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: `System: ${systemPrompt}\n\nUser: ${userPrompt}` }] }],
            generationConfig: { responseMimeType: "application/json" }
        })
    });
    const data = await response.json();
    const result = JSON.parse(data.candidates[0].content.parts[0].text);

    // Bonus si Side Objective trouvé
    if (result.isSideObjectiveFound) {
        result.aiResponse += "\n\n✨ [ÉVÉNEMENT] Vous avez découvert un secret de l'incursion !";
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ aiResponse: "Le destin vacille." });
  }
});

/**
 * POST /quest/resolve
 */
app.post("/quest/resolve", async (req, res) => {
    // Logique de fin identique mais incluant le bonus du side objective si trouvé
    const { player, quest } = req.body;
    const bonus = quest.sideObjectiveFound ? 2.0 : 1.0;

    const userPrompt = `Analyse le dénouement de la quête "${quest.title}". Progression: ${quest.progress}%. Side Objective trouvé: ${quest.sideObjectiveFound}.`;

    try {
        const response = await fetch("https://api.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=" + process.env.GEMINI_API_KEY, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: userPrompt }] }],
                generationConfig: { responseMimeType: "application/json" }
            })
        });
        const data = await response.json();
        const aiDecision = JSON.parse(data.candidates[0].content.parts[0].text);
        
        // Appliquer les multiplicateurs de récompense ici
        res.json(aiDecision);
    } catch (e) { res.status(500).send(); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Oracle V4 opérationnel sur ${PORT}`));