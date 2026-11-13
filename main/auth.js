const form = document.getElementById("login-form");
const loginInput = document.getElementById("login");
const passwordInput = document.getElementById("password");
const showPassword = document.getElementById("show-password");
const errorMessage = document.getElementById("login-error");

showPassword.addEventListener("change", () => {
  passwordInput.type = showPassword.checked ? "text" : "password";
});

form.addEventListener("submit", handleLogin);
form.addEventListener("input", clearError);

function handleLogin(event) {
  event.preventDefault();

  const login = loginInput.value.trim().toLowerCase();
  const password = passwordInput.value.trim();

  if (login !== "student" || password !== "English123!") {
    errorMessage.textContent = "Неверный логин или пароль.";
    errorMessage.hidden = false;
    return;
  }

  window.alert("Вход выполнен.");
  window.location.href = "home.html";
}

function clearError() {
  errorMessage.textContent = "";
  errorMessage.hidden = true;
}
