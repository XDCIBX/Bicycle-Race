// Изображения велосипедов: только нарисованная модель именно этого велосипеда
// (js/bikeart.js — по настоящей геометрии рамы, с брендом и моделью на раме).
// Фотографии из интернета не используются.
(function () {
  'use strict';
  // Убираем кэши фото из прошлых версий игры.
  try { ['velorush.photos.v1', 'velorush.photos.v2', 'velorush.photos.bad'].forEach((k) => localStorage.removeItem(k)); } catch (e) { /* игнорируем */ }

  // Контейнер .photo: модель велосипеда с установленными колёсами.
  function attach(el, bike, wheelId) {
    el.innerHTML = '';
    const img = document.createElement('img');
    img.alt = bike.name;
    img.src = window.BikeArt.dataUrl(bike, wheelId);
    img.className = 'bike-img art';
    el.appendChild(img);
  }

  window.BikePhotos = { attach };
})();
