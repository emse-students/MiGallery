export const load = async ({ locals }) => {

    /*const session = await locals.auth();
    return {
        session
    };*/

    return {
        session: {
            user: {
                id: "jolan.boudin",
                name: "Jolan BOUDIN",
                email: "jolan.boudin@etu.emse.fr"
            }
        }
    }
}