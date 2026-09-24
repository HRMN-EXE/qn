import { useEffect, useRef } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as Notifications from 'expo-notifications';

// Head-up display while the app itself is open
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

interface NativeAlarm {
  id: string;
  title: string;
  body: string;
  time: number; // ms epoch
}

// Injected into every page load.
// The web app (patched src/lib/alarm.ts) calls:
//   KairosNative.notify({ id, title, body })      → post one notification now
//   KairosNative.syncAlarms({ alarms: [...] })    → replace the whole schedule
// Plus: any uncaught web error is forwarded so it can be shown natively —
// no more silent "stuck on the loading animation" failures.
const BRIDGE_JS = `
(function(){
  window.KairosNative = {
    notify: function (o) { window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({ type: 'notify' }, o))); },
    syncAlarms: function (o) { window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({ type: 'syncAlarms' }, o))); },
  };
  function report(kind, msg) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'webError', message: kind + ': ' + String(msg).slice(0, 500) })); } catch (e) {}
  }
  // React hydration-mismatch codes (418/423/425) are expected here: the theme
  // pre-paint script mutates the DOM before React hydrates. React recovers
  // instantly — surfacing them would nag on every launch for no reason.
  var BENIGN = /Minified React error #(418|423|425)\b/;
  window.addEventListener('error', function (e) {
    var msg = e.message || '';
    if (BENIGN.test(msg)) return;
    report('error', msg + ' @ ' + (e.filename || '').split('/').pop() + ':' + e.lineno);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason, msg = r && r.message ? r.message : String(r);
    if (BENIGN.test(msg)) return;
    report('promise', msg);
  });
})();
true;
`;

type Msg =
  | { type: 'notify'; id?: string; title?: string; body?: string }
  | { type: 'syncAlarms'; alarms?: NativeAlarm[] }
  | { type: 'webError'; message: string };

// Built by plugins/with-web-assets.js into the APK's native assets.
const WEB_URL = 'file:///android_asset/web/index.html';

export default function App() {
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}

function Shell() {
  const insets = useSafeAreaInsets();
  const webRef = useRef<WebView>(null);
  const busy = useRef(false);
  const lastError = useRef('');

  useEffect(() => {
    (async () => {
      const cur = await Notifications.getPermissionsAsync();
      if (!cur.granted && cur.canAskAgain) await Notifications.requestPermissionsAsync();
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('alarms', {
          name: 'Alarms & reminders',
          importance: Notifications.AndroidImportance.MAX,
          sound: 'default',
          vibrationPattern: [300, 300, 300, 300],
          lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        });
      }
    })();
  }, []);

  const schedule = async (a: NativeAlarm) => {
    await Notifications.scheduleNotificationAsync({
      identifier: a.id,
      content: { title: a.title, body: a.body, sound: 'default' },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(a.time),
        channelId: 'alarms',
      },
    });
  };

  const onMessage = async (ev: { nativeEvent: { data: string } }) => {
    let m: Msg;
    try { m = JSON.parse(ev.nativeEvent.data) as Msg; } catch { return; }
    try {
      if (m.type === 'webError') {
        if (m.message !== lastError.current) {
          lastError.current = m.message;
          Alert.alert('Web error (report this if the app misbehaves)', m.message);
        }
        return;
      }
      if (busy.current) return; // one bridge op at a time
      busy.current = true;
      try {
        if (m.type === 'notify') {
          await Notifications.scheduleNotificationAsync({
            identifier: m.id || String(Date.now()),
            content: { title: m.title ?? 'Ledger', body: m.body ?? '', sound: 'default' },
            trigger: null, // immediately
          });
        } else if (m.type === 'syncAlarms') {
          // replace the entire native schedule with the freshest list
          const existing = await Notifications.getAllScheduledNotificationsAsync();
          for (const n of existing) await Notifications.cancelScheduledNotificationAsync(n.identifier);
          for (const a of m.alarms ?? []) {
            if (a.time > Date.now()) await schedule(a);
          }
        }
      } finally {
        busy.current = false;
      }
    } catch (e) {
      console.warn('kairos bridge error', e);
    }
  };

  return (
    <View style={[styles.container, safePad(insets)]}>
      <StatusBar style="light" />
      <WebView
        ref={webRef}
        source={{ uri: WEB_URL }}
        onMessage={onMessage}
        injectedJavaScript={BRIDGE_JS}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled                 // localStorage — your entire database
        allowFileAccess
        allowUniversalAccessFromFileURLs  // file:// can run its own resources
        startInLoadingState
        style={styles.dark}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  dark: { backgroundColor: '#060708' }, // matches the app shell — no white flash
});

// Android 15 draws apps edge-to-edge: the WebView would start behind the
// status bar / gesture bar, putting top toasts ("Done"/"Dismiss") and bottom
// controls half off-screen. Padding by the real insets keeps every pixel of
// your app's UI in the visible area, while the dark container still bleeds to
// all edges (seamless — no white bars).
function safePad(insets: EdgeInsets) {
  if (Platform.OS !== 'android') return null;
  return {
    paddingTop: insets.top,
    paddingBottom: insets.bottom,
  };
}
