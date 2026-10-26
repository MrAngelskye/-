const form = document.getElementById("login-form");
const loginInput = document.getElementById("login");
const passwordInput = document.getElementById("password");
const showPassword = document.getElementById("show-password");
const errorMessage = document.getElementById("login-error");

showPassword.addEventListener("change", function () {
  if (showPassword.checked) {
    passwordInput.type = "text";
  } else {
    passwordInput.type = "password";
  }
});

form.addEventListener("submit", function (event) {
  event.preventDefault();

  const login = loginInput.value.trim().toLowerCase();
  const password = passwordInput.value.trim();

  if (login === "student" && password === "English123!") {
    window.alert("Вход выполнен.");
    window.location.href = "home.html";
  } else {
    errorMessage.textContent = "Неверный логин или пароль.";
    errorMessage.hidden = false;
  }
});

form.addEventListener("input", function () {
  errorMessage.textContent = "";
  errorMessage.hidden = true;
});
