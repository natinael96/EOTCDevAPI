import Foundation

struct Named: Decodable { let amharic: String; let english: String? }
struct Ethiopic: Decodable { let date: String; let day: Int; let year: Int
                             let monthName: Named }
struct Fasting: Decodable { let isFasting: Bool; let reason: String }
struct Sinksar: Decodable { let annual: [String]; let monthly: [String] }
struct Today: Decodable { let ethiopic: Ethiopic; let weekday: Named
                          let fasting: Fasting; let sinksar: Sinksar? }

func fetchToday() async throws -> Today {
    // Reckon the day in Addis Ababa, not from the device clock.
    var components = URLComponents(
        string: "https://eotcdev-api.natinael-96.workers.dev/v1/today")!
    components.queryItems = [
        URLQueryItem(name: "tz", value: "Africa/Addis_Ababa"),
        URLQueryItem(name: "include", value: "sinksar"),
    ]
    var request = URLRequest(url: components.url!)
    request.setValue("my-eotc-app/1.0", forHTTPHeaderField: "User-Agent")
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
        throw URLError(.badServerResponse)
    }
    return try JSONDecoder().decode(Today.self, from: data)
}
