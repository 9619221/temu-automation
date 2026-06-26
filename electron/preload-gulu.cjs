// 咕噜噜窗口 preload（contextIsolation: false，与页面共享 window）
// 拦截自动 window.print()，只允许用户点击触发的打印
const origPrint = window.print.bind(window);
let userClicked = false;

window.print = function () {
  if (userClicked) {
    origPrint();
  } else {
    console.log("[Gulu] auto-print blocked");
  }
};

window.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("click", () => {
    userClicked = true;
    setTimeout(() => { userClicked = false; }, 500);
  }, true);
});
