import Capacitor
import Foundation
#if canImport(WidgetKit)
import WidgetKit
#endif

@objc(RitmolWidgetPlugin)
public class RitmolWidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RitmolWidgetPlugin"
    public let jsName = "RitmolWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "updateWidgetData", returnType: CAPPluginReturnPromise),
    ]

    private let appGroupId = "group.com.ritmol.app"

    @objc func updateWidgetData(_ call: CAPPluginCall) {
        guard let userDefaults = UserDefaults(suiteName: appGroupId) else {
            call.resolve()
            return
        }
        guard let dict = call.options as? [String: Any] else {
            call.resolve()
            return
        }
        if let data = try? JSONSerialization.data(withJSONObject: dict),
           let json = String(data: data, encoding: .utf8) {
            userDefaults.set(json, forKey: "ritmol_widget_payload")
            userDefaults.synchronize()
            #if canImport(WidgetKit)
            if #available(iOS 14.0, *) {
                WidgetCenter.shared.reloadAllTimelines()
            }
            #endif
        }
        call.resolve()
    }
}
