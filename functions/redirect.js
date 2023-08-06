export function onRequest(context) {
    console.log(context);
/*    return Response.redirect("https://heise.de/?foo=" + context.url);*/
    return new Response("hello");
}
