addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  // Log the request URL to the console
  console.log('Request URL:', request.url)

  // Your logic for handling the request goes here
  // For example, you can make a fetch request to a backend server and return its response
  const response = await fetch(request)

  return response
}

