/* =========================================================
   Nexus Optimizer — interactions
   ========================================================= */

(function () {
  "use strict";

  var $ = function (selector, context) {
    return (context || document).querySelector(selector);
  };
  var $$ = function (selector, context) {
    return Array.prototype.slice.call((context || document).querySelectorAll(selector));
  };

  var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- sticky header ---------- */

  var header = $("#siteHeader");
  if (header) {
    var updateHeader = function () {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
    };
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
  }

  /* ---------- mobile menu ---------- */

  var menuBtn = $("#menuBtn");
  var mobileMenu = $("#mobileMenu");

  function setMenuIcon(isOpen) {
    var icon = menuBtn ? menuBtn.querySelector("use") : null;
    if (icon) icon.setAttribute("href", isOpen ? "#i-close" : "#i-menu");
  }

  function closeMenu() {
    if (!mobileMenu || !menuBtn) return;
    mobileMenu.classList.remove("is-open");
    menuBtn.setAttribute("aria-expanded", "false");
    menuBtn.setAttribute("aria-label", "Open menu");
    setMenuIcon(false);
    document.body.classList.remove("is-locked");
  }

  function openMenu() {
    if (!mobileMenu || !menuBtn) return;
    mobileMenu.classList.add("is-open");
    menuBtn.setAttribute("aria-expanded", "true");
    menuBtn.setAttribute("aria-label", "Close menu");
    setMenuIcon(true);
    document.body.classList.add("is-locked");
  }

  if (menuBtn && mobileMenu) {
    menuBtn.addEventListener("click", function () {
      if (mobileMenu.classList.contains("is-open")) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    $$("a", mobileMenu).forEach(function (link) {
      link.addEventListener("click", closeMenu);
    });

    window.addEventListener("resize", function () {
      if (window.innerWidth > 900) closeMenu();
    });
  }

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") closeMenu();
  });

  /* ---------- module filters ---------- */

  var explorers = $$(".explorer-filter");
  var modules = $$(".explorer-card");
  var moduleCount = $("#moduleCount");

  function filterModules(filter) {
    var visible = 0;

    modules.forEach(function (card) {
      var show = filter === "all" || card.getAttribute("data-category") === filter;
      card.hidden = !show;
      if (show) visible += 1;
    });

    explorers.forEach(function (button) {
      var active = button.getAttribute("data-filter") === filter;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });

    if (moduleCount) {
      moduleCount.textContent = "Showing " + visible + " of " + modules.length + " modules.";
    }
  }

  explorers.forEach(function (button, index) {
    button.addEventListener("click", function () {
      filterModules(button.getAttribute("data-filter"));
    });

    button.addEventListener("keydown", function (event) {
      var next = null;
      if (event.key === "ArrowRight") next = (index + 1) % explorers.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + explorers.length) % explorers.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = explorers.length - 1;

      if (next !== null) {
        event.preventDefault();
        explorers[next].focus();
        filterModules(explorers[next].getAttribute("data-filter"));
      }
    });
  });

  /* ---------- reveal on scroll ---------- */

  var revealElements = $$("[data-reveal]");
  if (revealElements.length) {
    if ("IntersectionObserver" in window && !prefersReducedMotion) {
      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-revealed");
              observer.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.08, rootMargin: "0px 0px -48px 0px" }
      );
      revealElements.forEach(function (element) {
        observer.observe(element);
      });
    } else {
      revealElements.forEach(function (element) {
        element.classList.add("is-revealed");
      });
    }
  }

  /* ---------- faq: one answer at a time ---------- */

  var faqItems = $$(".faq-item");
  faqItems.forEach(function (item) {
    item.addEventListener("toggle", function () {
      if (!item.open) return;
      faqItems.forEach(function (other) {
        if (other !== item) other.open = false;
      });
    });
  });

  /* ---------- year ---------- */

  $$("[data-year]").forEach(function (element) {
    element.textContent = String(new Date().getFullYear());
  });
})();
