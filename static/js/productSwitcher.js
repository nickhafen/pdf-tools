// Brand dropdown for switching between suite tools. It's a <details> element,
// so open/close works without JS; this only adds dismiss-on-outside-click and
// Escape-to-close.
(() => {
  const switcher = document.getElementById("productSwitcher");
  if (!switcher) return;

  document.addEventListener("click", (e) => {
    if (switcher.open && !switcher.contains(e.target)) switcher.open = false;
  });

  switcher.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && switcher.open) {
      switcher.open = false;
      switcher.querySelector("summary").focus();
    }
  });
})();
