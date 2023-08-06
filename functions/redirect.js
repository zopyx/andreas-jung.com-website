export function onRequest(context) {
    console.log("a")
    console.log(context);
    console.log("b")
/*    return Response.redirect("https://heise.de/?foo=" + context.url);*/
    return new Response("hello1");
}
