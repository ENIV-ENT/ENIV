require('dotenv').config();
const SibApiV3Sdk = require('sib-api-v3-sdk');

// Configuration du client Brevo
const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;

const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

/**
 * Envoyer un email d'invitation pour créer un compte
 * @param {string} email - Email du destinataire
 * @param {string} token - Token d'invitation unique
 * @param {string} role - Role de l'utilisateur (admin ou eleve)
 * @param {string} className - Nom de la classe (optionnel)
 */
async function sendInvitationEmail(email, token, role, className = null) {
  const invitationUrl = `${process.env.BASE_URL}/register?token=${token}`;

  const roleText = role === 'admin' ? 'Administrateur' : 'Élève';
  const classeInfo = className ? `<p><strong>Classe :</strong> ${className}</p>` : '';

  const sendSmtpEmail = {
    to: [{ email }],
    sender: {
      email: process.env.BREVO_SENDER_EMAIL,
      name: process.env.BREVO_SENDER_NAME
    },
    subject: `Invitation à rejoindre Eniv - ${roleText}`,
    htmlContent: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .container {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 30px;
            margin: 20px 0;
          }
          .header {
            text-align: center;
            margin-bottom: 30px;
          }
          .header h1 {
            color: #2c3e50;
            margin: 0;
          }
          .content {
            background: white;
            padding: 25px;
            border-radius: 6px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          .info-box {
            background: #e3f2fd;
            padding: 15px;
            border-radius: 4px;
            margin: 20px 0;
            border-left: 4px solid #2196f3;
          }
          .button {
            display: inline-block;
            padding: 12px 30px;
            background: #4CAF50;
            color: white !important;
            text-decoration: none;
            border-radius: 5px;
            font-weight: bold;
            margin: 20px 0;
            text-align: center;
          }
          .button:hover {
            background: #45a049;
          }
          .footer {
            text-align: center;
            margin-top: 30px;
            color: #666;
            font-size: 0.9em;
          }
          .warning {
            color: #e74c3c;
            font-size: 0.9em;
            margin-top: 15px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Eniv</h1>
            <p>Espace Numérique de Travail</p>
          </div>

          <div class="content">
            <h2>Vous êtes invité(e) à rejoindre Eniv !</h2>

            <p>Bonjour,</p>

            <p>Vous avez été invité(e) à créer un compte sur la plateforme Eniv.</p>

            <div class="info-box">
              <p style="margin: 5px 0;"><strong>Rôle :</strong> ${roleText}</p>
              ${classeInfo}
              <p style="margin: 5px 0;"><strong>Email :</strong> ${email}</p>
            </div>

            <p>Pour finaliser votre inscription, cliquez sur le bouton ci-dessous et remplissez le formulaire avec vos informations :</p>

            <ul>
              <li>Nom</li>
              <li>Prénom</li>
              <li>Nom d'utilisateur (sera vérifié en temps réel)</li>
              <li>Mot de passe</li>
            </ul>

            <div style="text-align: center;">
              <a href="${invitationUrl}" class="button">Créer mon compte</a>
            </div>

            <p class="warning">
              ⚠️ Ce lien est valable pendant 7 jours et ne peut être utilisé qu'une seule fois.
            </p>

            <p>Si vous n'avez pas demandé cette invitation, vous pouvez ignorer ce message.</p>
          </div>

          <div class="footer">
            <p>Cet email a été envoyé automatiquement, merci de ne pas y répondre.</p>
            <p>&copy; 2025 Eniv - Tous droits réservés</p>
          </div>
        </div>
      </body>
      </html>
    `,
    textContent: `
Vous êtes invité(e) à rejoindre Eniv !

Rôle : ${roleText}
${className ? `Classe : ${className}` : ''}
Email : ${email}

Pour finaliser votre inscription, accédez au lien suivant :
${invitationUrl}

Vous devrez renseigner :
- Nom
- Prénom
- Nom d'utilisateur
- Mot de passe

Ce lien est valable pendant 7 jours et ne peut être utilisé qu'une seule fois.

Si vous n'avez pas demandé cette invitation, vous pouvez ignorer ce message.
    `
  };

  try {
    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log('Email d\'invitation envoyé avec succès à:', email);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('Erreur lors de l\'envoi de l\'email:', error);
    throw new Error('Impossible d\'envoyer l\'email d\'invitation');
  }
}

module.exports = {
  sendInvitationEmail
};
