(function () {
  'use strict';

  function cartCount() {
    try {
      const c = JSON.parse(localStorage.getItem('me_cart') || '[]');
      return Array.isArray(c) ? c.reduce((s, i) => s + (i.quantity || 1), 0) : 0;
    } catch { return 0; }
  }

  function activeClass(href) {
    const cur  = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
    const tgt  = href.split('#')[0].split('/').pop().toLowerCase();
    return cur === tgt ? 'nav-active' : '';
  }

  function header() {
    const n = cartCount();
    return `
<div class="top-bar">
  <span class="tb-accent">✦ FREE NY DELIVERY</span> on orders over $99 &nbsp;·&nbsp;
  <span class="tb-accent">24h</span> Tri-state delivery &nbsp;·&nbsp;
  hello@mobileexpressny.com
</div>
<header class="site-header">
  <div class="header-inner">
    <a href="index.html" class="logo-link">
      <img src="images/mobile-express-logo.png" alt="Mobile Express NY">
    </a>
    <nav class="site-nav" aria-label="Primary">
      <ul>
        <li><a href="index.html"           class="${activeClass('index.html')}">Home</a></li>
        <li><a href="index.html#catalog"   class="">Shop All</a></li>
        <li><a href="accessories.html"     class="${activeClass('accessories.html')}">Accessories</a></li>
        <li><a href="repairs.html"         class="${activeClass('repairs.html')}">Repairs</a></li>
        <li><a href="order-status.html"    class="${activeClass('order-status.html')}">Order Status</a></li>
        <li><a href="contact.html"         class="${activeClass('contact.html')}">Contact</a></li>
      </ul>
    </nav>
    <div class="header-cta">
      <a href="tel:+18456663989" class="support-tel">📞 (845) 666-3989</a>
      <a href="checkout.html" class="cart-btn" id="openCartBtn" aria-label="Shopping cart">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
        Cart <span class="cart-badge" id="cartCount">${n}</span>
      </a>
    </div>
  </div>
</header>`;
  }

  function footer() {
    return `
<footer class="site-footer">
  <div class="footer-inner">
    <div class="footer-top">
      <div class="footer-brand">
        <img src="images/mobile-express-logo.png" alt="Mobile Express NY">
        <p>Certified kosher flip phones, accessories, and concierge activation delivered nationwide.</p>
      </div>
      <div class="footer-col">
        <h4>Explore</h4>
        <a href="index.html">Home</a>
        <a href="index.html#catalog">Shop All</a>
        <a href="accessories.html">Accessories &amp; Cases</a>
        <a href="repairs.html">Repairs</a>
        <a href="order-status.html">Order Status</a>
        <a href="contact.html">Contact</a>
      </div>
      <div class="footer-col">
        <h4>Contact</h4>
        <a href="mailto:hello@mobileexpressny.com">hello@mobileexpressny.com</a>
        <a href="mailto:support@mobileexpressny.com">support@mobileexpressny.com</a>
        <a href="tel:+18456663989">(845) 666-3989</a>
      </div>
    </div>
    <div class="footer-bottom">
      <span>&copy; ${new Date().getFullYear()} Mobile Express NY &middot; mobileexpressny.com</span>
      <a href="https://www.advancedautomations.net" target="_blank" rel="noopener" class="footer-credit">
        <img src="images/advanced-automations-logo.png" alt="Advanced Automations">
        Powered by Advanced Automations
      </a>
    </div>
  </div>
</footer>`;
  }

  function init() {
    const hEl = document.getElementById('site-header');
    const fEl = document.getElementById('site-footer');
    if (hEl) hEl.innerHTML = header();
    if (fEl) fEl.innerHTML = footer();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
