cmake_minimum_required(VERSION 3.16)
project(NC7CamService LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(nc7-cam-service
  src/main.cpp
  src/cam_service.cpp
)
target_include_directories(nc7-cam-service PRIVATE src)
if(MSVC)
  target_compile_options(nc7-cam-service PRIVATE /W4)
else()
  target_compile_options(nc7-cam-service PRIVATE -Wall -Wextra -Wpedantic)
endif()
