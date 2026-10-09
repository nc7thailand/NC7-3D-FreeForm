#include "cam_service.hpp"

#include <iostream>
#include <string>

int main() {
  std::ios::sync_with_stdio(false);
  std::cin.tie(nullptr);

  nc7::CamService service;
  std::cout << service.helloLine() << std::flush;

  std::string line;
  while (std::getline(std::cin, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    if (line.empty()) continue;
    try {
      std::cout << service.handle(line, std::cout) << std::flush;
    } catch (const std::exception&) {
      std::cout
          << "{\"channel\":\"nc7-cam\",\"type\":\"result\",\"status\":\"error\",\"protocolVersion\":1,\"error\":\"native CAM service failed\"}\n"
          << std::flush;
    }
  }
  return 0;
}
