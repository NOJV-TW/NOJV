export const WASM_OJ_PCH_PATH = "wasm-oj.pch.hpp";

const BITS_STDCPP_INCLUDE = /^\s*#\s*include\s*<bits\/stdc\+\+\.h>/m;

export const CPP_STANDARD_HEADER_INCLUDES = `#include <any>
#include <atomic>
#include <bit>
#include <cfenv>
#include <cinttypes>
#include <clocale>
#include <codecvt>
#include <complex>
#include <cstdarg>
#include <ctime>
#include <cuchar>
#include <cwchar>
#include <cwctype>
#include <filesystem>
#include <format>
#include <forward_list>
#include <fstream>
#include <initializer_list>
#include <istream>
#include <list>
#include <locale>
#include <memory_resource>
#include <new>
#include <numbers>
#include <ostream>
#include <ratio>
#include <regex>
#include <scoped_allocator>
#include <source_location>
#include <stdexcept>
#include <streambuf>
#include <system_error>
#include <typeindex>
#include <typeinfo>
#include <valarray>
#include <version>
`;

export function cppStandardHeader(pchHeader: string): string {
  return `${pchHeader}\n${CPP_STANDARD_HEADER_INCLUDES}`;
}

export function withCppPlatformHeaders(
  files: Readonly<Record<string, string>>,
  pchHeader: string,
): Record<string, string> {
  const usesPlatformBitsStdcpp =
    files["bits/stdc++.h"] === undefined &&
    files["src/bits/stdc++.h"] === undefined &&
    Object.values(files).some((content) => BITS_STDCPP_INCLUDE.test(content));
  const result = { ...files };
  result["src/bits/stdc++.h"] ??= files["bits/stdc++.h"] ?? cppStandardHeader(pchHeader);
  if (usesPlatformBitsStdcpp) result[WASM_OJ_PCH_PATH] ??= pchHeader;
  return result;
}
