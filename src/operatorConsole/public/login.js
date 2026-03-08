/* global document, window */

const params = new URLSearchParams(window.location.search);
const error = params.get("error");

if (error) {
  const status = document.getElementById("login-status");
  status.textContent = error;
  status.classList.add("error");
}
