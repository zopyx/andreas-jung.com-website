export function onRequest(context) {
    return Response.redirect("https://heise.de/?foo=" + context.params.input);
}
