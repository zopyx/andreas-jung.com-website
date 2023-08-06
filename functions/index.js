export function onRequest(context) {
    return Response.redirect(context.params.input);
}
