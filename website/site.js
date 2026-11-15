// The links stay available without JavaScript; only small-screen disclosure is enhanced.
const toggle = document.getElementById("nav-toggle");
const navigation = document.getElementById("site-nav");
if (toggle && navigation) {
  const compact = window.matchMedia("(max-width: 960px)");
  const close = () => {
    toggle.setAttribute("aria-expanded", "false");
    navigation.hidden = compact.matches;
  };
  const adapt = () => {
    toggle.hidden = !compact.matches;
    close();
  };
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    navigation.hidden = !open;
  });
  navigation.addEventListener("click", (event) => {
    if (event.target.closest("a")) close();
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      toggle.getAttribute("aria-expanded") === "true"
    ) {
      close();
      toggle.focus();
    }
  });
  // A disclosure, rather than a modal: Tab can leave it normally.
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".site-header")) close();
  });
  compact.addEventListener("change", adapt);
  adapt();
}
