/* =====================================================
   Apps Script 기록 저장 API 연결
   - GitHub Pages(다른 주소)에서 호출하므로 fetch 사용
   - Content-Type을 지정하지 않아(text/plain) CORS 사전요청 없이 동작
===================================================== */
(function (root) {
  'use strict';
  const url = () => (root.LAB_CONFIG && root.LAB_CONFIG.API_URL) || '';

  async function call(action, payload) {
    if (!url()) throw new Error('API_URL이 설정되지 않았습니다.');
    const res = await fetch(url(), {
      method: 'POST',
      body: JSON.stringify(Object.assign({ action }, payload || {}))
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '서버 오류');
    return data;
  }

  async function getSettings() {
    if (!url()) throw new Error('API_URL이 설정되지 않았습니다.');
    const res = await fetch(url() + '?action=settings');
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '서버 오류');
    return data.settings;
  }

  root.LabApi = {
    get enabled() { return !!url(); },
    getSettings,
    saveStudent: data => call('save', { data }),
    dashboard: password => call('dashboard', { password }),
    saveSettings: (password, settings) => call('saveSettings', { password, settings }),
    clearStudents: password => call('clear', { password })
  };
})(window);
