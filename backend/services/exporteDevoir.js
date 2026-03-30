/**
 * Fonction pour partager une idée depuis un modal via un bouton
 * @param {string} ideaId - L'identifiant de l'idée à partager
 * @param {object} ideaData - Les données de l'idée (titre, description, etc.)
 */
function partagerIdee(ideaId, ideaData) {
    // Vérifier si l'API Web Share est disponible
    if (navigator.share) {
        navigator.share({
            title: ideaData.titre || 'Mon idée',
            text: ideaData.description || '',
            url: `${window.location.origin}/idee/${ideaId}`
        })
        .then(() => console.log('Idée partagée avec succès'))
        .catch((error) => console.error('Erreur lors du partage:', error));
    } else {
        // Fallback: copier le lien dans le presse-papier
        const url = `${window.location.origin}/idee/${ideaId}`;
        navigator.clipboard.writeText(url)
            .then(() => alert('Lien copié dans le presse-papier!'))
            .catch((error) => console.error('Erreur lors de la copie:', error));
    }
}

// Exemple d'utilisation avec un bouton dans un modal
// document.getElementById('btn-partager').addEventListener('click', () => {
//   partagerIdee('123', { titre: 'Mon idée', description: 'Description de l\'idée' });
// });

module.exports = { partagerIdee };