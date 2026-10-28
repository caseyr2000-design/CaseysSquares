// Your Google Apps Script web app URL (it ends in /exec).
// Find it in script.google.com → Deploy → Manage deployments.
window.SQUARES_API = "https://script.google.com/macros/s/AKfycbwvE_4KTABj1Jq1tGmb-ltxjVFUvmAfUzmobvq5qN9yFBAA4rhJKXuHlpoeoeO8CLe0/exec";

// Header picture shown at the top of the board (a header photo uploaded in the Commissioner panel replaces it).
window.SQUARES_HEADER_IMAGE = "header-combined.jpg";
// Title sits between the logo and the performer (from/to = share of the picture width); green and black fill
// any space beside the picture, and the strip below it is green.
window.SQUARES_HEADER_LAYOUT = { text: "between", from: 0.35, to: 0.6, bgLeft: "#234c48", bgRight: "#000000", strip: "#234c48" };
