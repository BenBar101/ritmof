import Capacitor
import HealthKit

@objc(RitmolHealthPlugin)
public class RitmolHealthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RitmolHealthPlugin"
    public let jsName = "RitmolHealth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getSleepData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
    ]

    private let store = HKHealthStore()

    @objc func checkPermission(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["granted": false])
            return
        }
        guard let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) else {
            call.resolve(["granted": false])
            return
        }
        let status = store.authorizationStatus(for: sleepType)
        call.resolve(["granted": status == .sharingAuthorized])
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["granted": false])
            return
        }
        guard let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) else {
            call.resolve(["granted": false])
            return
        }
        store.requestAuthorization(toShare: nil, read: [sleepType]) { success, _ in
            call.resolve(["granted": success])
        }
    }

    @objc func getSleepData(_ call: CAPPluginCall) {
        guard let dateStr = call.getString("date") else {
            call.resolve(["durationMinutes": NSNull(), "quality": NSNull()])
            return
        }
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.timeZone = TimeZone(secondsFromGMT: 0)
        df.dateFormat = "yyyy-MM-dd"
        guard let targetDate = df.date(from: dateStr) else {
            call.resolve(["durationMinutes": NSNull(), "quality": NSNull()])
            return
        }

        guard let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) else {
            call.resolve(["durationMinutes": NSNull(), "quality": NSNull()])
            return
        }

        let start = Calendar.current.startOfDay(for: targetDate)
        guard let end = Calendar.current.date(byAdding: .day, value: 1, to: start) else {
            call.resolve(["durationMinutes": NSNull(), "quality": NSNull()])
            return
        }
        let pred = HKQuery.predicateForSamples(withStart: start, end: end)

        let query = HKSampleQuery(sampleType: sleepType, predicate: pred, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, _ in
            guard let samples = samples as? [HKCategorySample], !samples.isEmpty else {
                call.resolve(["durationMinutes": NSNull(), "quality": NSNull()])
                return
            }
            var totalSeconds = 0.0
            var deepRem = 0.0
            for s in samples {
                let dur = s.endDate.timeIntervalSince(s.startDate)
                totalSeconds += dur
                if s.value == HKCategoryValueSleepAnalysis.asleepDeep.rawValue ||
                    s.value == HKCategoryValueSleepAnalysis.asleepREM.rawValue {
                    deepRem += dur
                }
            }
            let minutes = Int(totalSeconds / 60)
            let ratio = totalSeconds > 0 ? deepRem / totalSeconds : 0
            let quality: String
            if ratio >= 0.30 { quality = "excellent" }
            else if ratio >= 0.20 { quality = "good" }
            else if ratio >= 0.10 { quality = "fair" }
            else { quality = "poor" }

            call.resolve(["durationMinutes": minutes, "quality": quality])
        }
        store.execute(query)
    }
}
