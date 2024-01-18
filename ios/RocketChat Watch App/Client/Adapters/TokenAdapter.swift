import Foundation

struct TokenAdapter: RequestAdapter {
	private let server: Server
	
	init(server: Server) {
		self.server = server
	}
	
	func adapt(_ url: URL) -> URL {
		var url = url
		
		url.append(
			queryItems: [
				URLQueryItem(name: "rc_token", value: server.loggedUser.token),
				URLQueryItem(name: "rc_uid", value: server.loggedUser.id)
			]
		)
		
		return url
	}
	
	func adapt(_ urlRequest: URLRequest) -> URLRequest {
		var request = urlRequest
		request.addValue(server.loggedUser.id, forHTTPHeaderField: "x-user-id")
		request.addValue(server.loggedUser.token, forHTTPHeaderField: "x-auth-token")
		return request
	}
}
