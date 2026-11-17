const form = document.querySelector("#login-form");
let signingIn = false;
let loginMode;
async function loadMode() {
  try {
    const response=await fetch('/api/login-mode');
    if(!response.ok)throw new Error('Could not load sign-in options. Refresh to try again.');
    loginMode=(await response.json()).mode;
    const individual=loginMode==='accounts';
    document.querySelector('#username-label').hidden=!individual;
    document.querySelector('#username').required=individual;
    document.querySelector('#password-label').textContent=individual?'Password':'Team password';
    document.querySelector('#login-heading').textContent=individual?'Your training account':'Team sign-in';
    document.querySelector('#login-help').textContent=individual?'Sign in to access your training history. Contact your administrator for an account or password reset.':'Enter your team password to practice and view coaching progress.';
    form.querySelector('button').disabled=false;
    form.querySelector('button').textContent='Sign in';
  }catch(error){document.querySelector('#login-status').textContent=error.message;}
}
loadMode();
form.addEventListener("submit", async event => {
  event.preventDefault();
  if (signingIn || !loginMode) return;
  signingIn = true;
  const button = form.querySelector("button");
  const status = document.querySelector("#login-status");
  const password = document.querySelector("#team-password");
  button.disabled = true;
  button.textContent = "Signing in…";
  form.setAttribute("aria-busy", "true");
  status.classList.remove("login-error");
  status.textContent = "Signing in…";
  try {
    const response = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username:document.querySelector('#username').value,password: password.value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not sign in.");
    password.value = "";
    button.textContent = "Signed in — opening training…";
    status.textContent = "Password accepted. Opening your training dashboard…";
    window.location.replace(result.mustChangePassword?'/account':"/");
  } catch (error) {
    signingIn = false;
    button.disabled = false;
    button.textContent = "Sign in";
    form.setAttribute("aria-busy", "false");
    status.classList.add("login-error");
    status.textContent = error.message;
    password.value = "";
    password.focus();
  }
});
