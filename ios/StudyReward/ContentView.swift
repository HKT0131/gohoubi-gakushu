import SwiftUI
import WebKit

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var bridge = WebBridge()

    var body: some View {
        WebView(bridge: bridge)
            .ignoresSafeArea()
            .onChange(of: scenePhase) { phase in
                // クイズ中にアプリを離れたら「よそ見」として Web 側に通知
                if phase == .background || phase == .inactive {
                    bridge.webView?.evaluateJavaScript("window.dispatchEvent(new Event('appbackground'))")
                }
            }
    }
}

final class WebBridge: ObservableObject {
    weak var webView: WKWebView?
}

struct WebView: UIViewRepresentable {
    let bridge: WebBridge

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // localStorage を永続化
        // 同梱の BGM / ボイスを XHR で読み、AudioBuffer で隙間なくループ・ダッキングさせるため
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.mediaTypesRequiringUserActionForPlayback = []
        config.allowsInlineMediaPlayback = true
        config.userContentController.add(context.coordinator, name: "haptic")
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.uiDelegate = context.coordinator
        bridge.webView = webView

        if let dir = Bundle.main.url(forResource: "Web", withExtension: nil) {
            webView.loadFileURL(dir.appendingPathComponent("index.html"), allowingReadAccessTo: dir)
        }
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator() }

    // JS の alert / confirm をネイティブダイアログで表示
    final class Coordinator: NSObject, WKUIDelegate, WKScriptMessageHandler {
        // JS: window.webkit.messageHandlers.haptic.postMessage("success" | "error" | "light")
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            switch message.body as? String {
            case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
            case "error": UINotificationFeedbackGenerator().notificationOccurred(.error)
            default: UIImpactFeedbackGenerator(style: .light).impactOccurred()
            }
        }

        private func present(_ alert: UIAlertController) {
            UIApplication.shared.connectedScenes
                .compactMap { ($0 as? UIWindowScene)?.keyWindow?.rootViewController }
                .first?.present(alert, animated: true)
        }

        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
            present(a)
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            a.addAction(UIAlertAction(title: "キャンセル", style: .cancel) { _ in completionHandler(false) })
            a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
            present(a)
        }
    }
}
