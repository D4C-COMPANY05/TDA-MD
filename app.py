from flask import Flask, request, jsonify, send_file
import requests
import os
import PyPDF2
import io

app = Flask(__name__)

api_key = os.environ.get("GROQ_API_KEY")

url = "https://api.groq.com/openai/v1/chat/completions"

headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

# Stocke le document en mémoire (temporaire)
document_actuel = {"texte": "", "nom": ""}

def extraire_texte_pdf(fichier_bytes):
    """Extrait le texte d'un fichier PDF"""
    texte = ""
    pdf_reader = PyPDF2.PdfReader(io.BytesIO(fichier_bytes))
    for page in pdf_reader.pages:
        texte += page.extract_text() + "\n"
    return texte

def extraire_texte_txt(fichier_bytes):
    """Extrait le texte d'un fichier TXT"""
    return fichier_bytes.decode("utf-8")

@app.route("/")
def accueil():
    return send_file("index.html")

@app.route("/upload", methods=["POST"])
def upload():
    """Reçoit le fichier et extrait son texte"""
    if "fichier" not in request.files:
        return jsonify({"erreur": "Aucun fichier reçu"}), 400

    fichier = request.files["fichier"]
    nom = fichier.filename
    contenu = fichier.read()

    # Extrait le texte selon le type de fichier
    if nom.endswith(".pdf"):
        texte = extraire_texte_pdf(contenu)
    elif nom.endswith(".txt"):
        texte = extraire_texte_txt(contenu)
    else:
        return jsonify({"erreur": "Format non supporté. PDF ou TXT seulement"}), 400

    # Limite à 3000 mots pour ne pas dépasser les limites de l'API
    mots = texte.split()
    if len(mots) > 3000:
        texte = " ".join(mots[:3000])
        tronque = True
    else:
        tronque = False

    document_actuel["texte"] = texte
    document_actuel["nom"] = nom

    return jsonify({
        "message": f"Document '{nom}' chargé avec succès",
        "mots": len(mots),
        "tronque": tronque
    })

@app.route("/question", methods=["POST"])
def question():
    """Répond à une question sur le document chargé"""
    if not document_actuel["texte"]:
        return jsonify({"erreur": "Aucun document chargé"}), 400

    question_user = request.json["question"]

    system_prompt = f"""Tu es un assistant expert en analyse de documents.
Tu dois répondre aux questions en te basant UNIQUEMENT sur le document fourni.
Si la réponse ne se trouve pas dans le document, dis-le clairement.
Sois précis et cite les parties pertinentes du document.

Voici le contenu du document '{document_actuel['nom']}' :
---
{document_actuel['texte']}
---"""

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": question_user}
    ]

    reponse = requests.post(url, json={
        "model": "llama-3.3-70b-versatile",
        "messages": messages
    }, headers=headers)

    texte = reponse.json()["choices"][0]["message"]["content"]

    return jsonify({"reponse": texte})

@app.route("/reset", methods=["POST"])
def reset():
    document_actuel["texte"] = ""
    document_actuel["nom"] = ""
    return jsonify({"statut": "Document effacé"})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)