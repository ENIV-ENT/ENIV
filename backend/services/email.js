require('dotenv').config();
const { BrevoClient } = require('@getbrevo/brevo');

const brevo = new BrevoClient({ apiKey: process.env.BREVO_API_KEY });

const EMAIL_STYLES = `
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
`;

/**
 * Build an info-box with a specific color theme.
 * @param {string} innerHtml - HTML content inside the box
 * @param {{ background: string, border: string }} colors - Box color theme
 */
function buildInfoBox(innerHtml, colors) {
  return `
    <div style="background: ${colors.background}; padding: 15px; border-radius: 4px; margin: 20px 0; border-left: 4px solid ${colors.border};">
      ${innerHtml}
    </div>`;
}

/**
 * Wrap body content in the shared HTML email layout.
 * @param {string} headerTitle - Text for the header h1
 * @param {string} bodyHtml - Inner HTML for the .content section
 * @param {string} [extraStyles] - Additional CSS rules appended after base styles
 * @param {{ showCopyright?: boolean }} [options]
 */
function buildEmailHtml(headerTitle, bodyHtml, extraStyles = '', options = {}) {
  const { showCopyright = true } = options;
  const copyrightLine = showCopyright
    ? '<p>&copy; 2025 Eniv - Tous droits réservés</p>'
    : '';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>${EMAIL_STYLES}${extraStyles}</style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>${headerTitle}</h1>
        </div>
        <div class="content">
          ${bodyHtml}
        </div>
        <div class="footer">
          <p>Cet email a été envoyé automatiquement, merci de ne pas y répondre.</p>
          ${copyrightLine}
        </div>
      </div>
    </body>
    </html>`;
}

/**
 * Send a transactional email via Brevo.
 * @param {string} recipientEmail
 * @param {string} subject
 * @param {string} htmlContent
 * @param {string} textContent
 * @param {string} logLabel - Label used in log messages
 */
async function sendEmail(recipientEmail, subject, htmlContent, textContent, logLabel) {
  const sendSmtpEmail = {
    to: [{ email: recipientEmail }],
    sender: {
      email: process.env.BREVO_SENDER_EMAIL,
      name: process.env.BREVO_SENDER_NAME
    },
    subject,
    htmlContent,
    textContent
  };

  try {
    const result = await brevo.transactionalEmails.sendTransacEmail(sendSmtpEmail);
    console.log(`${logLabel} sent to:`, recipientEmail);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error(`Failed to send (${logLabel}):`, error);
    throw new Error(`Failed to send the email (${logLabel})`, { cause: error });
  }
}

/**
 * Sends an invitation email to create an account.
 * @param {string} email - recipient
 * @param {string} token - unique invitation token
 * @param {string} role - user role (admin or eleve)
 * @param {string} [className] - name of the class
 */
async function sendInvitationEmail(email, token, role, className = null) {
  const invitationUrl = `${process.env.BASE_URL}/register?token=${token}`;
  const roleText = role === 'admin' ? 'Administrateur' : 'Élève';

  const infoLines = `<p style="margin: 5px 0;"><strong>Rôle :</strong> ${roleText}</p>`
    + (className ? `<p style="margin: 5px 0;"><strong>Classe :</strong> ${className}</p>` : '');

  const bodyHtml = `
    <h2>Vous êtes invité(e) à rejoindre Eniv !</h2>
    <p>Bonjour,</p>
    <p>Vous avez été invité(e) à créer un compte sur la plateforme Eniv.</p>
    ${buildInfoBox(infoLines, { background: '#e3f2fd', border: '#2196f3' })}
    <p>Pour finaliser votre inscription, cliquez sur le bouton ci-dessous et remplissez le formulaire avec vos informations :</p>
    <ul>
      <li>Nom</li>
      <li>Prénom</li>
      <li>Nom d'utilisateur</li>
      <li>Mot de passe</li>
    </ul>
    <div style="text-align: center;">
      <a href="${invitationUrl}" class="button">Créer mon compte</a>
    </div>
    <p class="warning">
      ⚠️ Ce lien est valable pendant 7 jours et ne peut être utilisé qu'une seule fois.
    </p>
    <p>Si vous n'avez pas demandé cette invitation, vous pouvez ignorer ce message.</p>`;

  const textContent = `
Vous êtes invité(e) à rejoindre Eniv !

Rôle : ${roleText}
${className ? `Classe : ${className}` : ''}

Pour finaliser votre inscription, accédez au lien suivant :
${invitationUrl}

Vous devrez renseigner :
- Nom
- Prénom
- Nom d'utilisateur
- Mot de passe

Ce lien est valable pendant 7 jours et ne peut être utilisé qu'une seule fois.

Si vous n'avez pas demandé cette invitation, vous pouvez ignorer ce message.
    `;

  const htmlContent = buildEmailHtml('Eniv', bodyHtml);
  return sendEmail(email, `Invitation à rejoindre Eniv - ${roleText}`, htmlContent, textContent, 'Invitation email');
}

/**
 * Sends an email when the quiz of an assignment is ready.
 * @param {string} email - recipient
 * @param {string} assignmentTitle
 * @param {number} assignmentId
 */
async function sendQuizReadyEmail(email, assignmentTitle, assignmentId) {
  const quizUrl = `${process.env.BASE_URL}/quiz?id=${assignmentId}`;

  const infoLines = `<p style="margin: 5px 0;"><strong>Devoir :</strong> ${assignmentTitle}</p>`;

  const bodyHtml = `
    <h2>Quiz de révision disponible</h2>
    <p>Bonjour,</p>
    <p>Bonne nouvelle ! Le quiz de révision pour votre devoir est maintenant disponible.</p>
    ${buildInfoBox(infoLines, { background: '#e8f5e9', border: '#4caf50' })}
    <p>Le quiz a été généré automatiquement à partir des documents du devoir. Vous pouvez maintenant vous entraîner et réviser efficacement.</p>
    <div style="text-align: center;">
      <a href="${quizUrl}" class="button">Commencer le quiz</a>
    </div>
    <p>Bon courage pour vos révisions ! 💪</p>`;

  const textContent = `
Votre quiz est prêt !

Le quiz de révision pour votre devoir "${assignmentTitle}" est maintenant disponible.

Pour commencer le quiz, accédez au lien suivant :
${quizUrl}

Bon courage pour vos révisions !
    `;

  const htmlContent = buildEmailHtml('✅ Votre quiz est prêt !', bodyHtml);
  return sendEmail(email, `Votre quiz est prêt : ${assignmentTitle}`, htmlContent, textContent, 'Quiz ready email');
}

/**
 * Tells a class admin about a new join request.
 * @param {string} adminEmail
 * @param {string} studentName - full name of the student
 * @param {string} className
 */
async function sendJoinRequestEmail(adminEmail, studentName, className) {
  const dashboardUrl = `${process.env.BASE_URL}/dashboard/`;

  const infoLines = `
    <p style="margin: 5px 0;"><strong>Nom :</strong> ${studentName}</p>
    <p style="margin: 5px 0;"><strong>Classe :</strong> ${className}</p>`;

  const bodyHtml = `
    <h2>Nouvelle demande d'adhésion</h2>
    <p>Bonjour,</p>
    <p>Un nouvel utilisateur souhaite rejoindre votre classe.</p>
    ${buildInfoBox(infoLines, { background: '#fff3cd', border: '#ffc107' })}
    <p>Vous pouvez accepter ou refuser cette demande depuis votre tableau de bord.</p>
    <div style="text-align: center;">
      <a href="${dashboardUrl}" class="button">Voir les demandes</a>
    </div>`;

  const textContent = `
Nouvelle demande d'adhésion - ${className}

${studentName} souhaite rejoindre votre classe "${className}".

Connectez-vous à votre tableau de bord pour accepter ou refuser la demande :
${dashboardUrl}
    `;

  const htmlContent = buildEmailHtml('Eniv', bodyHtml, '', { showCopyright: false });
  return sendEmail(adminEmail, `Nouvelle demande d'adhésion - ${className}`, htmlContent, textContent, 'Join request email');
}

/**
 * Tells a student that their join request was accepted.
 * @param {string} studentEmail
 * @param {string} studentName - full name of the student
 * @param {string} className
 */
async function sendJoinRequestAcceptedEmail(studentEmail, studentName, className) {
  const dashboardUrl = `${process.env.BASE_URL}/dashboard/`;

  const infoLines = `
    <p style="margin: 5px 0;"><strong>Élève :</strong> ${studentName}</p>
    <p style="margin: 5px 0;"><strong>Classe :</strong> ${className}</p>`;

  const bodyHtml = `
    <h2>Demande d'adhésion acceptée</h2>
    <p>Bonjour ${studentName},</p>
    <p>Bonne nouvelle ! Votre demande d'adhésion a été acceptée.</p>
    ${buildInfoBox(infoLines, { background: '#e8f5e9', border: '#4caf50' })}
    <p>Vous pouvez maintenant accéder à votre tableau de bord.</p>
    <div style="text-align: center;">
      <a href="${dashboardUrl}" class="button">Accéder au tableau de bord</a>
    </div>`;

  const textContent = `
Demande d'adhésion acceptée - ${className}

Bonjour ${studentName},

Votre demande d'adhésion à la classe "${className}" a été acceptée.

Accédez à votre tableau de bord :
${dashboardUrl}
  `;

  const htmlContent = buildEmailHtml('Bienvenue sur Eniv', bodyHtml, '', { showCopyright: false });
  return sendEmail(studentEmail, `Demande acceptée - ${className}`, htmlContent, textContent, 'Join request accepted email');
}

/**
 * Tells the superadmin about a request to add a school.
 * @param {string} superadminEmail
 * @param {string} schoolName - name of the requested school
 * @param {string} requesterEmail
 */
async function sendSchoolRequestEmail(superadminEmail, schoolName, requesterEmail) {
  const dashboardUrl = `${process.env.BASE_URL}/superadmin/dashboard/`;

  const infoLines = `
    <p style="margin: 5px 0;"><strong>Établissement :</strong> ${schoolName}</p>
    <p style="margin: 5px 0;"><strong>Email du demandeur :</strong> ${requesterEmail}</p>`;

  const bodyHtml = `
    <h2>Nouvelle demande d'ajout d'établissement</h2>
    <p>Bonjour,</p>
    <p>Un utilisateur a soumis une demande d'ajout d'établissement qui n'existe pas encore dans la base.</p>
    ${buildInfoBox(infoLines, { background: '#fff3cd', border: '#ffc107' })}
    <p>Vous pouvez accepter ou refuser cette demande depuis votre tableau de bord.</p>
    <div style="text-align: center;">
      <a href="${dashboardUrl}" class="button">Voir les demandes</a>
    </div>`;

  const textContent = `
Nouvelle demande d'ajout d'établissement

Un utilisateur souhaite ajouter l'établissement "${schoolName}".
Email du demandeur : ${requesterEmail}

Connectez-vous à votre tableau de bord pour accepter ou refuser la demande :
${dashboardUrl}
  `;

  const htmlContent = buildEmailHtml('Eniv', bodyHtml, '', { showCopyright: false });
  return sendEmail(superadminEmail, `Nouvelle demande d'établissement - ${schoolName}`, htmlContent, textContent, 'School request email');
}

module.exports = {
  sendInvitationEmail,
  sendQuizReadyEmail,
  sendJoinRequestEmail,
  sendJoinRequestAcceptedEmail,
  sendSchoolRequestEmail
};
